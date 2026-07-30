import { LightningElement, api } from 'lwc';
import { normalizeBoolean } from 'c/sentinelUtils';

const DEBOUNCE_MS = 250;

/**
 * Control strip shared by every Sentinel list view: search, sort, a live result
 * count and the refresh control. Keeps the eight components from each inventing
 * their own toolbar.
 */
export default class SentinelFilterBar extends LightningElement {
    @api searchTerm = '';
    @api searchLabel = 'Search';
    @api searchPlaceholder = 'Search…';
    @api sortOptions;
    @api sortValue;
    @api sortLabel = 'Sort by';
    @api shownCount = 0;
    @api totalCount = 0;
    @api noun = 'records';

    _timer;
    _loading = false;
    _hideSearch = false;

    @api
    get loading() {
        return this._loading;
    }
    set loading(value) {
        this._loading = normalizeBoolean(value);
    }

    @api
    get hideSearch() {
        return this._hideSearch;
    }
    set hideSearch(value) {
        this._hideSearch = normalizeBoolean(value);
    }

    get showSearch() {
        return !this._hideSearch;
    }
    get showSort() {
        return !!(this.sortOptions && this.sortOptions.length);
    }
    get refreshLabel() {
        return this._loading ? 'Refreshing data…' : 'Refresh';
    }

    get countLabel() {
        const shown = Number(this.shownCount) || 0;
        const total = Number(this.totalCount) || 0;
        if (total === 0) return `No ${this.noun}`;
        if (shown === total) return `${total} ${this.noun}`;
        return `${shown} of ${total} ${this.noun}`;
    }

    handleSearch(event) {
        const value = event.detail ? event.detail.value : '';
        // Debounced so typing does not re-filter a 200-row list on every keystroke.
        // The timer is cleared on disconnect, which is what the lint rule guards against.
        window.clearTimeout(this._timer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._timer = window.setTimeout(() => {
            this.dispatchEvent(new CustomEvent('search', { detail: { value } }));
        }, DEBOUNCE_MS);
    }

    handleSort(event) {
        this.dispatchEvent(new CustomEvent('sort', { detail: { value: event.detail.value } }));
    }

    handleRefresh() {
        this.dispatchEvent(new CustomEvent('refresh'));
    }

    disconnectedCallback() {
        window.clearTimeout(this._timer);
    }
}
