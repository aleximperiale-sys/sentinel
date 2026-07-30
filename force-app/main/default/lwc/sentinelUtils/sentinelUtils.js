/**
 * sentinelUtils, shared helpers for the Sentinel LWC surface.
 *
 * Service module (no template). Keeps error translation, number formatting and
 * severity mapping in one place instead of repeating it in eight components.
 */

/**
 * Coerces a public boolean property the way the Lightning base components do.
 * A valueless attribute (`<c-thing compact>`) arrives as the empty string, so
 * every boolean @api in this app runs through here.
 */
export function normalizeBoolean(value) {
    return typeof value === 'string' ? true : !!value;
}

/**
 * Turns any Apex / LDS / JS error shape into a human sentence plus the raw
 * technical detail, so the UI can stay friendly while developers keep the
 * diagnostics (log `detail`, render `message`).
 */
export function reduceError(error) {
    const detail = safeStringify(error);
    let message = '';

    if (!error) {
        message = '';
    } else if (Array.isArray(error.body)) {
        message = error.body.map((e) => e.message).filter(Boolean).join(', ');
    } else if (error.body && typeof error.body.message === 'string') {
        message = error.body.message;
    } else if (error.body && error.body.pageErrors && error.body.pageErrors.length) {
        message = error.body.pageErrors.map((e) => e.message).join(', ');
    } else if (typeof error.message === 'string') {
        message = error.message;
    } else if (typeof error === 'string') {
        message = error;
    }

    return { message: message || 'Unknown error', detail, friendly: friendlyFor(message) };
}

/**
 * Maps known Apex/platform failure shapes onto plain-language guidance.
 * Falls back to a generic sentence, never to a raw stack trace.
 */
function friendlyFor(raw) {
    const text = (raw || '').toLowerCase();
    if (!text) {
        return 'Something went wrong while loading this view.';
    }
    if (text.includes('no sentinel_config__mdt found')) {
        return 'This view needs a Sentinel configuration record for the object it monitors. Ask an admin to add one in Setup, Custom Metadata Types, Sentinel Config.';
    }
    if (text.includes('unsafe identifier')) {
        return 'A Sentinel configuration record contains a field name Sentinel cannot use. Ask an admin to review the watched-object configuration.';
    }
    if (text.includes('insufficient') || text.includes('access') || text.includes('permission')) {
        return 'You do not have access to some of the records or fields this view needs. Ask an admin to assign the Sentinel User permission set.';
    }
    if (text.includes('no such column') || text.includes('invalid field') || text.includes('didn\'t understand')) {
        return 'A field in the Sentinel configuration does not exist on that object in this org. Ask an admin to correct the watched-object configuration.';
    }
    if (text.includes('too many soql') || text.includes('limit exceeded') || text.includes('governor')) {
        return 'Sentinel hit a platform limit while checking this many records. Narrow the watched-object filters, or try again in a moment.';
    }
    if (text.includes('timeout') || text.includes('network') || text.includes('failed to fetch')) {
        return 'The request did not reach Salesforce. Check your connection and try again.';
    }
    return 'Something went wrong while loading this view. Retrying usually fixes it.';
}

function safeStringify(error) {
    try {
        if (!error) return '';
        if (typeof error === 'string') return error;
        return JSON.stringify(error, replacer, 2);
    } catch (e) {
        return String(error);
    }
}

function replacer(key, value) {
    return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
}

/** Compact money for hero numerals ("$1.2M"). Exact value belongs in the label. */
export function compactCurrency(amount, symbol = '$') {
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1000000000) return `${sign}${symbol}${trim(abs / 1000000000)}B`;
    if (abs >= 1000000) return `${sign}${symbol}${trim(abs / 1000000)}M`;
    if (abs >= 1000) return `${sign}${symbol}${trim(abs / 1000)}K`;
    return `${sign}${symbol}${Math.round(abs)}`;
}

function trim(value) {
    const rounded = Math.round(value * 10) / 10;
    return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1);
}

/** Whole-number percentage, guarded against a zero denominator. */
export function percent(part, whole) {
    const total = Number(whole) || 0;
    if (total <= 0) return 0;
    return Math.round(((Number(part) || 0) / total) * 100);
}

/** Case-insensitive "contains" used by every search box in the app. */
export function matches(haystack, needle) {
    if (!needle) return true;
    return String(haystack || '').toLowerCase().includes(String(needle).toLowerCase());
}
