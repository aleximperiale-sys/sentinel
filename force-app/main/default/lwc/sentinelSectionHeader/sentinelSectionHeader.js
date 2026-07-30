import { LightningElement, api } from 'lwc';

/**
 * Sentinel page header, the dark "control room" rail every Sentinel tab starts
 * with. Owns the eyebrow / title / description and exposes an `actions` slot so
 * each page supplies its own primary control (refresh, range switch, ...).
 */
export default class SentinelSectionHeader extends LightningElement {
    @api headline;
    @api description;
    @api eyebrow = 'SENTINEL';
    @api iconName = 'utility:socialshare';
    /** Optional scoreboard readout on the right (e.g. "12 · critical now"). */
    @api readoutValue;
    @api readoutLabel;

    get showReadout() {
        return this.readoutValue !== undefined && this.readoutValue !== null && this.readoutValue !== '';
    }
}
