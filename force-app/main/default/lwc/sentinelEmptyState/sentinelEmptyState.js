import { LightningElement, api } from 'lwc';

const ICONS = {
    success: 'utility:success',
    neutral: 'utility:search',
    info: 'utility:info'
};

/**
 * Intentional empty state. `tone="success"` is the important one for Sentinel:
 * a watchdog finding nothing is a win, so "no gaps found" must read as a pass,
 * not as missing data.
 */
export default class SentinelEmptyState extends LightningElement {
    @api headline = 'Nothing to show';
    @api message;
    /** Recommended next action, plain sentence. */
    @api nextStep;
    @api tone = 'success';
    @api iconName;
    @api actionLabel;
    @api actionIcon;

    get resolvedIcon() {
        return this.iconName || ICONS[this.tone] || ICONS.neutral;
    }

    get containerClass() {
        return `es es--${this.tone}`;
    }

    get medallionClass() {
        return `es__medallion es__medallion--${this.tone}`;
    }

    handleAction() {
        this.dispatchEvent(new CustomEvent('action'));
    }
}
