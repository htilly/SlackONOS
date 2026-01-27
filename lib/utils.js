'use strict'

function numFormatter(num) {
    if (num === null || num === undefined) return '';
    return Number(num).toLocaleString('en-US');
}

module.exports = {
    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    numFormatter
};
