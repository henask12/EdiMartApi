"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCreatedAtRange = exports.parseDateEnd = exports.parseDateStart = void 0;
const parseDateStart = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new Error("Invalid date");
    }
    d.setHours(0, 0, 0, 0);
    return d;
};
exports.parseDateStart = parseDateStart;
const parseDateEnd = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new Error("Invalid date");
    }
    d.setHours(23, 59, 59, 999);
    return d;
};
exports.parseDateEnd = parseDateEnd;
const buildCreatedAtRange = (from, to) => {
    if (!from && !to) {
        return undefined;
    }
    const range = {};
    if (from) {
        range.gte = (0, exports.parseDateStart)(from);
    }
    if (to) {
        range.lte = (0, exports.parseDateEnd)(to);
    }
    return range;
};
exports.buildCreatedAtRange = buildCreatedAtRange;
//# sourceMappingURL=date-range.util.js.map