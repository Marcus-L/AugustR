import { Component } from '@angular/core';
import { AlertController, Platform } from 'ionic-angular';
import { AugustLockService } from "../../components/augustlockservice";
import { NativeStorage, Toast } from "ionic-native";
import { Firebase } from "ionic-native";

@Component({
  selector: 'lockpage',
  templateUrl: 'lockpage.html'
})
export class LockPage {

  private isUnlocking: boolean;

  constructor(private lock: AugustLockService, private platform: Platform, private alert: AlertController) {
    Firebase.getToken().then(token => {
      // register for the token
      Firebase.subscribe("unlock");

      Firebase.onNotificationOpen().subscribe(notification => {
        switch (notification.action) {
          case "unlock":
            this.doUnlock();
            break;
          // todo: implement other actions here
          default:
            console.log(notification);
        }
      });
    }).catch(error => {
      this.alert.create({
        title: "Startup Error",
        subTitle: "Could not register device with server, exiting.",
        buttons: ["OK"]
      }).present();
      this.platform.exitApp();
    });
  }

  showToast(log: string): void {
    Toast.show(log, "4000", "bottom")
      .subscribe(t => console.log(t));
  };

  doUnlock(): void {
    // try the unlock 2x
    this.sendUnlock().then(
      success => { },
      failure => this.sendUnlock().then(
        success => { },
        failure => this.showToast("failed 2x")
      )
    )
  }

  sendUnlock(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      let handleError = err => {
        this.isUnlocking = false;
        this.showToast(err);
        console.log(err);
        reject();
      }
      if (this.platform.is("cordova")) {
        this.isUnlocking = true;
        NativeStorage.getItem("settings").then(settings => {
          this.lock.offlineKey = settings.offlineKey
          this.lock.offlineKeyOffset = settings.offlineKeyOffset;
          this.lock.connect().then(() => {
            this.lock.unlock().then(() => {
              this.isUnlocking = false;
              this.showToast("Unlocked");
              this.lock.disconnect();
              resolve();
            }).catch(handleError);
          }).catch(handleError);
        }, error => handleError("Settings not configured"));
      } else {
        handleError("Platform is not Cordova");
      }
    });
  }
}
