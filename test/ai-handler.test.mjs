import { expect } from 'chai';
import { getSeasonalContext } from '../ai-handler.js';

describe('AI Handler', function() {
  describe('#getSeasonalContext', function() {
    it('should return seasonal context object', function() {
      const ctx = getSeasonalContext();
      
      expect(ctx).to.be.an('object');
      expect(ctx).to.have.property('season');
      expect(ctx).to.have.property('month');
      expect(ctx).to.have.property('themes');
      expect(ctx).to.have.property('suggestion');
      
      expect(ctx.season).to.be.a('string');
      expect(ctx.month).to.be.a('string');
      expect(ctx.themes).to.be.an('array');
      expect(ctx.suggestion).to.be.a('string');
    });

    it('should return valid month name', function() {
      const ctx = getSeasonalContext();
      const validMonths = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];
      
      expect(validMonths).to.include(ctx.month);
    });

    it('should return themes array with at least one theme', function() {
      const ctx = getSeasonalContext();
      expect(ctx.themes.length).to.be.greaterThan(0);
    });

    it('should return a valid season', function() {
      const ctx = getSeasonalContext();
      const validSeasons = ['Winter', 'Spring', 'Summer', 'Autumn', 'Winter/Holiday', 'Halloween', "Valentine's"];
      
      expect(validSeasons).to.include(ctx.season);
    });
  });
});
