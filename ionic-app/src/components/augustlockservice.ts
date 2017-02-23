import { Injectable, EventEmitter } from "@angular/core";
import { BLE } from "ionic-native";
import "rxjs/add/operator/first";
import { Buffer } from "buffer";
import * as crypto from "crypto-browserify";

// ported from https://github.com/ethitter/augustctl/blob/master/lib/lock_session.js
class LockSession {
    private encryptCipher: any;
    private decryptCipher: any;
    private dataStream: EventEmitter<any> = new EventEmitter<any>();
    protected cipherSuite: string = "aes-128-cbc";
    protected iv: any = (() => {
        let buf = new Buffer(0x10);
        buf.fill(0);
        return buf;
    })();

    constructor(
        private service: string,
        public peripheral: string,
        private writeCharacteristic: string,
        private readCharacteristic: string) {
    }

    setKey(key: any): void {
        this.encryptCipher = crypto.createCipheriv(this.cipherSuite, key, this.iv);
        this.encryptCipher.setAutoPadding(false);
        this.decryptCipher = crypto.createDecipheriv(this.cipherSuite, key, this.iv);
        this.decryptCipher.setAutoPadding(false);
    }

    start(): void {
        BLE.startNotification(this.peripheral, this.service, this.readCharacteristic)
            .subscribe(data => {
                data = new Buffer(new Uint8Array(data));
                if (this.decryptCipher) {
                    AugustLockService.debug("encrypted data: " + data.toString("hex"));
                    let cipherText = data.slice(0x00, 0x10);
                    let plainText = this.decryptCipher.update(cipherText.toString("hex"), "hex");
                    plainText.copy(cipherText);
                }
                AugustLockService.debug("received data: " + data.toString("hex"));
                this.dataStream.emit(data);
            });
    }

    buildCommand(opcode: number): any {
        let cmd = new Buffer(0x12);
        cmd.fill(0);
        cmd.writeUInt8(0xee, 0x00);   // magic
        cmd.writeUInt8(opcode, 0x01);
        cmd.writeUInt8(0x02, 0x10);   // unknown?
        return cmd;
    }

    simpleChecksum(buf: any): number {
        let cs = 0;
        for (let i = 0; i < 0x12; i++) {
            cs = (cs + buf[i]) & 0xff;
        }
        return (-cs) & 0xff;
    }

    protected writeChecksum(command: any): void {
        let checksum = this.simpleChecksum(command);
        command.writeUInt8(checksum, 0x03);
    }

    protected validateResponse(response: any): void {
        if (this.simpleChecksum(response) !== 0) {
            throw new Error("simple checksum mismatch");
        }
        if (response[0] !== 0xbb && response[0] !== 0xaa) {
            throw new Error("unexpected magic in response");
        }
    }

    private write(command: any): Promise<any> {
        // NOTE: the last two bytes are not encrypted
        // general idea seems to be that if the last byte of the command indicates an offline key offset (is non-zero), the command is "secure" and encrypted with the offline key
        if (this.encryptCipher) {
            var plainText = command.slice(0x00, 0x10);
            var cipherText = this.encryptCipher.update(plainText);
            cipherText.copy(plainText);
            AugustLockService.debug("write (encrypted): " + command.toString("hex"));
        }

        // write the command to the write characteristic
        return BLE.write(this.peripheral, this.service, this.writeCharacteristic, command.buffer);
    }

    execute(command: any): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.writeChecksum(command);

            this.dataStream.first().subscribe(data => {
                this.validateResponse(data);
                resolve(data);
            });

            AugustLockService.debug("execute command: " + command.toString("hex"));
            this.write(command).then(() => {
                AugustLockService.debug("write successful");
            });
        })
    }
}

// ported from https://github.com/ethitter/augustctl/blob/master/lib/secure_lock_session.js
class SecureLockSession extends LockSession {
    constructor(service: string, peripheral: any, writeCharacteristic: string, readCharacteristic: string, private offlineKeyOffset: number) {
        super(service, peripheral, writeCharacteristic, readCharacteristic);
        if (!offlineKeyOffset) {
            throw new Error("offline key offset not specified");
        }
        this.cipherSuite = "aes-128-ecb";
        this.iv = "";
    }

    buildCommand(opcode: number): any {
        var cmd = new Buffer(0x12);
        cmd.fill(0);
        cmd.writeUInt8(opcode, 0x00);
        cmd.writeUInt8(0x0f, 0x10);   // unknown
        cmd.writeUInt8(this.offlineKeyOffset, 0x11);
        return cmd;
    }

    securityChecksum(buffer: any): number {
        return (0 - (buffer.readUInt32LE(0x00) + buffer.readUInt32LE(0x04) + buffer.readUInt32LE(0x08))) >>> 0;
    }

    protected writeChecksum(command: any): void {
        var checksum = this.securityChecksum(command);
        command.writeUInt32LE(checksum, 0x0c);
    }

    protected validateResponse(data: any): void {
        if (this.securityChecksum(data) !== data.readUInt32LE(0x0c)) {
            throw new Error("security checksum mismatch");
        }
    }
}

const AUGUST_SERVICE: string = "bd4ac610-0b45-11e3-8ffd-0800200c9a66";

@Injectable()
// ported from https://github.com/ethitter/augustctl/blob/master/lib/lock.js
export class AugustLockService {

    private lock_session: LockSession;
    private secure_lock_session: SecureLockSession
    private isSecure: boolean;

    // public properties
    public offlineKey: string;
    public offlineKeyOffset: number;
    public id: string;

    constructor() { }

    public static debug(log: string): void {
        console.log(log);
    }

    connect(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.scan().then(p => {
                // connect to the lock to get the characteristics
                BLE.connect(p.id).subscribe(peripheral => {
                    this.id = p.id;
                    
                    // configure pipes
                    if (!this.setupSessions(p)) {
                        reject("Invalid Key/Offset");
                        return;
                    }
                    // handshake
                    this.performHandshake().then(() => {
                        resolve(true);
                    });
                }, error => {
                    if (error.errorMessage != "Peripheral Disconnected") {
                        throw new Error("connecting to lock '" + p.id + "' failed.");
                    }
                });
            }, error => { reject(error); });
        });
    }

    private scan(): Promise<any> {
        return new Promise<boolean>((resolve, reject) => {
            let lock_found = false;
            // scan to find the lock device
            BLE.scan([AUGUST_SERVICE], 10).first(p => p.name == "Aug").subscribe(p => {
                lock_found = true;
                AugustLockService.debug("found lock: " + p.id);
                resolve(p);
            }, error => { throw new Error("could not connect to lock"); });
            setTimeout(() => {
                if (!lock_found) {
                    reject("No lock found during BLE scan");
                }
            }, 10000);
        });
    }

    private setupSessions(peripheral: any): boolean {
        AugustLockService.debug("connected to lock: " + peripheral.id);
        this.secure_lock_session = new SecureLockSession(AUGUST_SERVICE, peripheral.id, "bd4ac613-0b45-11e3-8ffd-0800200c9a66", "bd4ac614-0b45-11e3-8ffd-0800200c9a66", this.offlineKeyOffset);
        try {
            this.secure_lock_session.setKey(new Buffer(this.offlineKey, "hex"));
        } catch (error) {
            return false;
        }
        this.lock_session = new LockSession(AUGUST_SERVICE, peripheral.id, "bd4ac611-0b45-11e3-8ffd-0800200c9a66", "bd4ac612-0b45-11e3-8ffd-0800200c9a66");

        // start up pipes
        this.secure_lock_session.start();
        this.lock_session.start();
        return true;
    }

    private performHandshake(): Promise<any> {
        let handshakeKeys = crypto.randomBytes(16); // random data
        return new Promise<any>((resolve, reject) => {
            let cmd = this.secure_lock_session.buildCommand(0x01);
            handshakeKeys.copy(cmd, 0x04, 0x00, 0x08);
            this.secure_lock_session.execute(cmd).then(response => {
                if (response[0] !== 0x02) {
                    throw new Error("unexpected response to SEC_LOCK_TO_MOBILE_KEY_EXCHANGE: " + response.toString("hex"));
                }
                AugustLockService.debug("handshake complete");

                // secure session established
                this.isSecure = true;

                // setup the session key
                let sessionKey = new Buffer(16);
                handshakeKeys.copy(sessionKey, 0x00, 0x00, 0x08);
                response.copy(sessionKey, 0x08, 0x04, 0x0c);
                this.lock_session.setKey(sessionKey);

                // rekey the secure session as well
                this.secure_lock_session.setKey(sessionKey);

                // send SEC_INITIALIZATION_COMMAND
                let cmd = this.secure_lock_session.buildCommand(0x03);
                handshakeKeys.copy(cmd, 0x04, 0x08, 0x10);
                this.secure_lock_session.execute(cmd).then(response => {
                    if (response[0] !== 0x04) {
                        throw new Error("unexpected response to SEC_INITIALIZATION_COMMAND: " + response.toString("hex"));
                    }
                    AugustLockService.debug("lock initialized");
                    resolve(true);
                });
            }, error => {
                throw new Error("Error sending handshake.");
            });
        });
    }

    forceLock(): Promise<void> {
        AugustLockService.debug('locking...');
        let cmd = this.lock_session.buildCommand(0x0b);
        return this.lock_session.execute(cmd);
    }

    forceUnlock(): Promise<void> {
        AugustLockService.debug('unlocking...');
        let cmd = this.lock_session.buildCommand(0x0a);
        return this.lock_session.execute(cmd);
    }

    lock(): Promise<void> {
        return this.status().then(status => {
            if (status == 'unlocked')
                return this.forceLock();
        });
    };

    unlock(): Promise<void> {
        return this.status().then(status => {
            if (status == 'locked')
                return this.forceUnlock();
        });
    };

    status(): Promise<string> {
        AugustLockService.debug('status...');
        var cmd = new Buffer(0x12);
        cmd.fill(0x00);
        cmd.writeUInt8(0xee, 0x00); // magic
        cmd.writeUInt8(0x02, 0x01);
        cmd.writeUInt8(0x02, 0x04);
        cmd.writeUInt8(0x02, 0x10);

        return this.lock_session.execute(cmd).then(response => {
            var status = response.readUInt8(0x08);

            var strstatus = 'unknown';
            if (status == 0x03)
                strstatus = 'unlocked';
            else if (status == 0x05)
                strstatus = 'locked';

            AugustLockService.debug(strstatus);
            return strstatus;
        });
    }

    disconnect(): Promise<void> {
        AugustLockService.debug('disconnecting...');
        if (this.lock_session instanceof LockSession) {
            let disconnect = () => BLE.disconnect(this.lock_session.peripheral);

            if (this.isSecure) {
                this.isSecure = false;
                let cmd = this.secure_lock_session.buildCommand(0x05);
                cmd.writeUInt8(0x00, 0x11);
                this.secure_lock_session.execute(cmd).then(response => {
                    if (response[0] !== 0x8b) {
                        throw new Error("unexpected response to DISCONNECT: " + response.toString('hex'));
                    }
                    return true;
                }).then(disconnect);
            } else {
                return disconnect();
            }
        }
        else {
            return Promise.resolve(null);
        }
    }

    isConnected(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            AugustLockService.debug('checking connection...');
            if (this.lock_session instanceof LockSession) {
                BLE.isConnected(this.lock_session.peripheral).then(connected => {
                    resolve(connected);
                })
            }
            return false;
        });
    }
}