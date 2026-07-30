import { LightningElement, api } from 'lwc';
import { percent, normalizeBoolean } from 'c/sentinelUtils';

/**
 * Stacked proportional bar for freshness bands / gap types.
 *
 * Segments are distinguished by hatch pattern as well as colour, and the same
 * numbers are repeated as labelled badges underneath, so the chart is never the
 * only place the data exists.
 *
 * segments: [{ key, label, count, severity }]
 */
export default class SentinelBandBar extends LightningElement {
    @api segments = [];
    @api total = 0;
    @api unitLabel = 'records';

    _hideLegend = false;
    _thick = false;

    @api
    get hideLegend() {
        return this._hideLegend;
    }
    set hideLegend(value) {
        this._hideLegend = normalizeBoolean(value);
    }

    @api
    get thick() {
        return this._thick;
    }
    set thick(value) {
        this._thick = normalizeBoolean(value);
    }

    get resolvedTotal() {
        const declared = Number(this.total) || 0;
        if (declared > 0) return declared;
        return (this.segments || []).reduce((sum, s) => sum + (Number(s.count) || 0), 0);
    }

    get showLegend() {
        return !this._hideLegend && (this.segments || []).length > 0;
    }

    get trackClass() {
        return `bb__track${this._thick ? ' bb__track--thick' : ''}`;
    }

    get visibleSegments() {
        const total = this.resolvedTotal;
        return (this.segments || [])
            .filter((s) => (Number(s.count) || 0) > 0)
            .map((s) => {
                const pct = percent(s.count, total);
                const sev = String(s.severity || 'neutral').toLowerCase();
                return {
                    key: s.key || s.label,
                    className: `bb__seg bb__seg--${sev}`,
                    style: `width:${pct}%`,
                    title: `${s.label}: ${s.count} of ${total} ${this.unitLabel} (${pct}%)`
                };
            });
    }

    get ariaLabel() {
        const total = this.resolvedTotal;
        if (!total) return `No ${this.unitLabel}`;
        const parts = (this.segments || []).map(
            (s) => `${s.label} ${Number(s.count) || 0}, ${percent(s.count, total)} percent`
        );
        return `${total} ${this.unitLabel}: ${parts.join('; ')}`;
    }
}
