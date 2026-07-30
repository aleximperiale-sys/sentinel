import { LightningElement, api } from 'lwc';
import { normalizeBoolean } from 'c/sentinelUtils';

/**
 * KPI card for one watched object. Owns its own loading / error / empty
 * ("all clear") states so callers never have to duplicate them, and exposes an
 * expandable list of the oldest records behind the number.
 *
 * Expected `card` shape (built by sentinelDashboard):
 *   { label, objectApiName, staleCount, thresholdDays, severity,
 *     bands: [{key,label,count,severity}], owners: [{key,count}],
 *     trend: {icon,direction,text,note,severity}|null,
 *     records: [{id,name,url,band,severity,ageText,explanation}], moreCount }
 */
export default class SentinelStatCard extends LightningElement {
    @api card = {};
    /** Friendly error sentence; renders the inline error state when set. */
    @api error;

    expanded = false;
    _loading = false;

    /** Skeleton inside the card's own box. */
    @api
    get loading() {
        return this._loading;
    }
    set loading(value) {
        this._loading = normalizeBoolean(value);
    }

    get errorTitle() {
        return this.card && this.card.label ? this.card.label : 'Object health';
    }

    get cardClass() {
        const sev = String((this.card && this.card.severity) || 'neutral').toLowerCase();
        // While loading or failed, the child state component supplies the chrome,
        // so the card drops its own border to avoid a double frame.
        const bare = this._loading || this.error ? ' sc--bare' : '';
        return `sc sc--${sev}${bare}`;
    }

    get isClear() {
        return !this.card || !Number(this.card.staleCount);
    }

    get clearText() {
        const days = this.card && this.card.thresholdDays;
        return days
            ? `Nothing has been idle longer than ${days} days.`
            : 'Nothing is currently at risk for this object.';
    }

    get thresholdLabel() {
        const days = this.card && this.card.thresholdDays;
        return days ? `Idle over ${days}d` : 'No threshold set';
    }

    get hasOwners() {
        return !!(this.card && this.card.owners && this.card.owners.length);
    }
    get topOwner() {
        return this.hasOwners ? this.card.owners[0] : null;
    }

    get hasRecords() {
        return !!(this.card && this.card.records && this.card.records.length);
    }

    get trendClass() {
        const sev = String((this.card.trend && this.card.trend.severity) || 'neutral').toLowerCase();
        return `sc__trend sc__trend--${sev}`;
    }

    get expandedAttr() {
        return this.expanded ? 'true' : 'false';
    }
    get toggleIcon() {
        return this.expanded ? 'utility:chevronup' : 'utility:chevrondown';
    }
    get toggleLabel() {
        const n = this.hasRecords ? this.card.records.length : 0;
        return this.expanded ? 'Hide oldest records' : `Show ${n} oldest records`;
    }
    get moreText() {
        return `${this.card.moreCount} more at-risk records not shown here`;
    }

    toggleRecords() {
        this.expanded = !this.expanded;
    }

    handleRetry() {
        this.dispatchEvent(new CustomEvent('retry'));
    }
}
