import { Component } from '@angular/core';
import { AugustLockService } from "../../components/augustlockservice";
import { NativeStorage } from "ionic-native";

@Component({
  selector: "settingspage",
  templateUrl: 'settingspage.html'
})
export class SettingsPage {

  private offlineKey: string;
  private offlineKeyOffset: number;

  // "60f9cf9ebb08ce1c77b3f119afcf1001", 1
  constructor(private augustLockService: AugustLockService) {
    NativeStorage.getItem("settings").then(data => {
      this.offlineKey = data.offlineKey
      this.offlineKeyOffset = data.offlineKeyOffset;
    }, error => {
      console.log("no settings available.");
    });
  } 

  saveSettings() {
    NativeStorage.setItem("settings", {
      offlineKey: this.offlineKey,
      offlineKeyOffset: this.offlineKeyOffset
    });
  }
}
