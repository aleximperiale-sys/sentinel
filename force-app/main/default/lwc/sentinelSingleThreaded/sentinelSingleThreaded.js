import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getSingleThreaded from '@salesforce/apex/SentinelDashboardController.getSingleThreaded';

export default class SentinelSingleThreaded extends LightningElement {
    records;
    error;
    _wired;

    @wire(getSingleThreaded)
    wiredRecords(result) {
        this._wired = result;
        if (result.data) {
            this.records = result.data;
            this.error = undefined;
        } else if (result.error) {
            this.error = result.error;
            this.records = undefined;
        }
    }

    get loading() {
        return !this.records && !this.error;
    }
    get hasData() {
        return !!(this.records && this.records.length > 0);
    }
    get showEmpty() {
        return !!(this.records && this.records.length === 0);
    }
    get errorMessage() {
        if (!this.error) return '';
        return this.error.body ? this.error.body.message : this.error.message;
    }
    get count() {
        return this.hasData ? this.records.length : 0;
    }

    get rows() {
        if (!this.hasData) return [];
        return this.records.map((r) => ({
            key: r.id,
            name: r.name,
            owner: r.ownerName || 'Unassigned',
            stage: r.priority || '(no stage)',
            band: r.band,
            bandClass: 'st-band st-band--' + (r.band || '').toLowerCase(),
            amountFormatted: r.amount ? '$' + Math.round(r.amount).toLocaleString('en-US') : ', ',
            url: r.url
        }));
    }

    handleRefresh() {
        return refreshApex(this._wired);
    }
}
