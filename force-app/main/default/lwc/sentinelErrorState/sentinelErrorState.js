import { LightningElement, api } from 'lwc';
import { normalizeBoolean } from 'c/sentinelUtils';

/**
 * Persistent inline error. Shows the human sentence, keeps the raw platform
 * error one click away for developers, and offers a retry when retrying is
 * reasonable (every Sentinel read is idempotent, so it always is).
 */
export default class SentinelErrorState extends LightningElement {
    @api headline = 'This view could not load';
    /** Plain-language sentence produced by sentinelUtils.reduceError(). */
    @api friendlyMessage = 'Something went wrong while loading this view.';
    /** Raw error payload, rendered only when the user expands the details. */
    @api technicalDetail = '';
    detailExpanded = false;

    _showRetry = true;
    _retrying = false;

    /** Every Sentinel read is idempotent, so retry is offered by default. */
    @api
    get showRetry() {
        return this._showRetry;
    }
    set showRetry(value) {
        this._showRetry = normalizeBoolean(value);
    }

    @api
    get retrying() {
        return this._retrying;
    }
    set retrying(value) {
        this._retrying = normalizeBoolean(value);
    }

    get retryLabel() {
        return this._retrying ? 'Retrying…' : 'Try again';
    }
    get detailToggleLabel() {
        return this.detailExpanded ? 'Hide technical details' : 'Show technical details';
    }
    get detailToggleIcon() {
        return this.detailExpanded ? 'utility:chevronup' : 'utility:chevrondown';
    }
    get showDetail() {
        return this.detailExpanded && !!this.technicalDetail;
    }

    toggleDetail() {
        this.detailExpanded = !this.detailExpanded;
    }

    handleRetry() {
        this.dispatchEvent(new CustomEvent('retry'));
    }
}
