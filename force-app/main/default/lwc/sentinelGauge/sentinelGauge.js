import { LightningElement, api } from 'lwc';

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // 263.89

/**
 * Circular progress dial for Sentinel's share-of-risk readouts. Hand-rolled
 * inline SVG (no charting library), with role="img" plus an aria-label carrying
 * the same number the sighted user sees.
 */
export default class SentinelGauge extends LightningElement {
    @api label;
    @api caption;
    @api unit = '%';
    @api severity = 'info';
    /** small | medium | large */
    @api size = 'medium';

    _value = 0;

    @api
    get value() {
        return this._value;
    }
    set value(v) {
        const n = Number(v);
        this._value = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
    }

    get displayValue() {
        return Math.round(this._value);
    }

    get rootClass() {
        return `gg gg--${this.size} gg--${String(this.severity).toLowerCase()}`;
    }

    get rings() {
        const offset = CIRCUMFERENCE - (this._value / 100) * CIRCUMFERENCE;
        return [
            {
                key: `arc-${this.displayValue}`,
                style: `stroke-dasharray:${CIRCUMFERENCE.toFixed(2)};--gg-offset:${offset.toFixed(2)};--gg-full:${CIRCUMFERENCE.toFixed(
                    2
                )}`
            }
        ];
    }

    get ariaLabel() {
        const parts = [this.label || 'Gauge', `${this.displayValue}${this.unit}`];
        if (this.caption) parts.push(this.caption);
        return parts.join(', ');
    }
}
