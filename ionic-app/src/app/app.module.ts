import { NgModule, ErrorHandler } from '@angular/core';
import { IonicApp, IonicModule, IonicErrorHandler } from 'ionic-angular';
import { MyApp } from './app.component';
import { LockPage } from '../pages/lockpage/lockpage';
import { SettingsPage } from '../pages/settingspage/settingspage';
import { TabsPage } from "../pages/tabs/tabs";
import { AugustLockService } from "../components/augustlockservice"

@NgModule({
  declarations: [
    MyApp,
    LockPage,
    SettingsPage,
    TabsPage
  ],
  imports: [
    IonicModule.forRoot(MyApp)
  ],
  bootstrap: [IonicApp],
  entryComponents: [
    MyApp,
    LockPage,
    SettingsPage,
    TabsPage
  ],
  providers: [
    {provide: ErrorHandler, useClass: IonicErrorHandler},
    AugustLockService
  ]
})
export class AppModule {}