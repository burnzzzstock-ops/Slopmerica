// Install a controlled surface-history fixture in the browser. The city stays
// at its saved day. An isolated instance of its actual Climate class computes
// wetness and snow, then the fixture loads those surface values before capture.
export function installWeatherFixture() {
  window.__weatherFixture = async (kind, options = {}) => {
    const g = window.__game;
    const rainy = ['rain', 'storm', 'hurricane'].includes(kind);
    const snowy = ['snow', 'blizzard'].includes(kind);
    const surface = options.surface ?? (rainy ? 'wet' : snowy ? 'snow' : 'dry');
    const bound = g.climate && g.weather.ctx?.climate === g.climate;
    if (!bound) {
      // Preserve the original 232272c screenshot path exactly. That renderer
      // owns its weather state and has no authoritative climate binding.
      if (!options.keepKind) {
        g.weather.force(kind, 30);
        g.weather.settle();
        g.weather.snowCover = 0;
      }
      if (options.surface) g.weather.wet = surface === 'wet' ? 1 : 0;
      return { source: 'legacy-renderer', wet: g.weather.wet, snow: g.weather.snowCover };
    }
    g.env.hour = g.hour;
    const { DAY_SECONDS } = await import('/src/sim/sim.ts');
    const history = new g.climate.constructor(g.map.def.id, 1776);
    const days = surface === 'wet' ? 84 : surface === 'snow' ? 28 : 0;
    if (days) {
      history.force(surface === 'wet' ? 'rain' : 'snow', g.sim.day - days, days + 1);
      for (let step = 1; step <= days * 4; step++) {
        history.step(DAY_SECONDS / 4, g.sim.day - days + step / 4, g.hour, 0);
      }
    }
    g.climate.load({ ...g.climate.save(), wet: history.wet, snowCover: history.snowCover });
    if (!options.keepKind) g.weather.force(kind, 30);
    g.weather.settle();
    return {
      source: 'climate-history', seed: 1776, historyDays: days,
      wet: g.climate.wet, snow: g.climate.snowCover,
    };
  };
}
