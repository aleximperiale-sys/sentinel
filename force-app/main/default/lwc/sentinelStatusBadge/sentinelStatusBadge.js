import { LightningElement, api } from 'lwc';
import { normalizeBoolean } from 'c/sentinelUtils';

/**
 * Status pill. Every severity carries a distinct icon *and* a text label, so the
 * meaning survives greyscale, colour-blindness and printing, colour is only a
 * reinforcement here.
 */
const SEVERITIES = {
    critical: { icon: 'utility:error', text: 'Critical severity' },
    stale: { icon: 'utility:warning', text: 'Stale severity' },
    aging: { icon: 'utility:clock', text: 'Aging severity' },
    success: { icon: 'utility:check', text: 'Healthy' },
    info: { icon: 'utility:info', text: 'Information' },
    neutral: { icon: 'utility:dash', text: '' }
};

export default class SentinelStatusBadge extends LightningElement {
    @api label;
    @api severity = 'neutral';
    @api count;
    @api tooltip;
    _compact = false;

    /** Compact drops the label padding for dense table rows. */
    @api
    get compact() {
        return this._compact;
    }
    set compact(value) {
        this._compact = normalizeBoolean(value);
    }

    get config() {
        return SEVERITIES[String(this.severity).toLowerCase()] || SEVERITIES.neutral;
    }
    get icon() {
        return this.config.icon;
    }
    get severityText() {
        return this.config.text;
    }
    get showCount() {
        return this.count !== undefined && this.count !== null && this.count !== '';
    }
    get badgeClass() {
        const sev = String(this.severity).toLowerCase();
        return `sb sb--${sev}${this._compact ? ' sb--compact' : ''}`;
    }
}
