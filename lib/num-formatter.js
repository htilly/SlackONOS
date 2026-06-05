function numFormatter(num) {
  if (num === null || num === undefined) return '';
  return Number(num).toLocaleString('en-US');
}

module.exports = numFormatter;
