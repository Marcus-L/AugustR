import { Component } from '@angular/core';
import { LockPage } from "../lockpage/lockpage"
import { SettingsPage } from "../settingspage/settingspage"

@Component({
    templateUrl: 'tabs.html'
})
export class TabsPage {
    tab1Root: any = LockPage;
    tab2Root: any = SettingsPage;

    constructor() {}
}
