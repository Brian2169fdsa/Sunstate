/* Mock trips dataset + /api/query handler for Sun State Transportation prototype.
 * Deterministic — same data on every load. No patient data, ever.
 */

(function () {
  const FACILITIES = [
    "Sunrise Senior Living",
    "Memorial Regional Hospital",
    "Valley Dialysis Center",
    "Oakwood Rehab",
    "St. Mary's Clinic",
    "Riverside Care",
    "Cypress Manor",
    "Lakeview Medical",
    "Coral Springs Surgical",
    "Highland Hospice",
  ];

  const SPACE_TYPES = ["stretcher", "wheelchair", "ambulatory"];
  const STATUSES = ["completed", "canceled", "no_show", "scheduled"];
  const DRIVERS = [
    "M. Alvarez", "J. Carter", "R. Nguyen", "D. Patel", "A. Brooks",
    "S. Romero", "K. Liu", "T. Washington", "L. Khan", "P. Reyes",
  ];

  // Seeded RNG — Mulberry32
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NOW = new Date("2026-05-22T12:00:00Z");
  const DAYS_BACK = 120;

  function buildTrips() {
    const r = rng(42);
    const trips = [];
    // ~9 trips/day per facility on average; some facilities trend down recently.
    for (let d = 0; d < DAYS_BACK; d++) {
      const dateBase = new Date(NOW.getTime() - d * 24 * 3600 * 1000);
      for (let fi = 0; fi < FACILITIES.length; fi++) {
        const facility = FACILITIES[fi];
        // Per-facility daily volume — slight weekday boost, recent decline for some.
        const dow = dateBase.getUTCDay();
        const weekday = dow !== 0 && dow !== 6;
        let base = 6 + (fi % 4); // 6..9
        // Trend modifiers: facility 1 (Memorial) & 4 (St. Mary's) declining last 35 days
        if (d < 35 && (fi === 1 || fi === 4)) base -= 3;
        // Facility 2 (Valley Dialysis) growing
        if (d < 35 && fi === 2) base += 2;
        if (!weekday) base = Math.max(1, base - 3);
        const count = Math.max(0, Math.round(base + (r() * 3 - 1.5)));

        for (let k = 0; k < count; k++) {
          // Status distribution — completed dominates; cancellations vary by facility.
          const cancelRate =
            fi === 3 ? 0.18 :          // Oakwood Rehab high cancel rate
            fi === 7 ? 0.14 :          // Lakeview Medical
            0.07 + (r() * 0.04);
          const u = r();
          let status;
          if (u < cancelRate) status = "canceled";
          else if (u < cancelRate + 0.03) status = "no_show";
          else if (d < 2 && u < cancelRate + 0.10) status = "scheduled";
          else status = "completed";

          // Space type — facility-skewed
          let spaceType;
          const sm = r();
          if (fi === 2) {
            // Dialysis — heavy wheelchair
            spaceType = sm < 0.7 ? "wheelchair" : sm < 0.95 ? "ambulatory" : "stretcher";
          } else if (fi === 9) {
            // Hospice — heavy stretcher
            spaceType = sm < 0.65 ? "stretcher" : sm < 0.9 ? "wheelchair" : "ambulatory";
          } else {
            spaceType = sm < 0.5 ? "wheelchair" : sm < 0.85 ? "ambulatory" : "stretcher";
          }

          const distance = Math.round((4 + r() * 22) * 10) / 10;
          // Price by service class
          const base_price = spaceType === "stretcher" ? 24000 : spaceType === "wheelchair" ? 11500 : 7800;
          const mileage = Math.round(distance * 350);
          const price_cents = base_price + mileage;

          const pickupHour = 6 + Math.floor(r() * 12);
          const pickupMin = Math.floor(r() * 4) * 15;
          const scheduled = new Date(dateBase);
          scheduled.setUTCHours(pickupHour, pickupMin, 0, 0);

          trips.push({
            facility,
            status,
            space_type: spaceType,
            service_class: spaceType === "stretcher" ? "STR" : spaceType === "wheelchair" ? "WC" : "AMB",
            scheduled_pickup_at: scheduled.toISOString(),
            price_cents,
            distance_miles: distance,
            driver_name: DRIVERS[Math.floor(r() * DRIVERS.length)],
            is_will_call: r() < 0.08,
          });
        }
      }
    }
    return trips;
  }

  const TRIPS = buildTrips();

  // ───── Period helpers ─────────────────────────────────────
  function periodRange(period) {
    const end = new Date(NOW);
    let start;
    switch (period) {
      case "this_month":
        start = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
        return { start, end, label: "this month" };
      case "last_month": {
        const ls = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 1));
        const le = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
        return { start: ls, end: le, label: "last month" };
      }
      case "last_30_days":
        start = new Date(NOW.getTime() - 30 * 24 * 3600 * 1000);
        return { start, end, label: "last 30 days" };
      case "last_90_days":
        start = new Date(NOW.getTime() - 90 * 24 * 3600 * 1000);
        return { start, end, label: "last 90 days" };
      case "ytd":
        start = new Date(Date.UTC(NOW.getUTCFullYear(), 0, 1));
        return { start, end, label: "year to date" };
      default:
        start = new Date(NOW.getTime() - 30 * 24 * 3600 * 1000);
        return { start, end, label: "last 30 days" };
    }
  }

  function inRange(t, range) {
    const d = new Date(t.scheduled_pickup_at);
    return d >= range.start && d < range.end;
  }

  // Fuzzy facility match
  function resolveFacility(needle) {
    if (!needle) return null;
    const n = needle.toLowerCase().trim();
    let best = null, bestScore = 0;
    for (const f of FACILITIES) {
      const fl = f.toLowerCase();
      let score = 0;
      if (fl === n) score = 100;
      else if (fl.includes(n)) score = 50 + n.length;
      else {
        // token overlap
        const tokens = n.split(/\s+/);
        for (const tok of tokens) if (tok.length > 2 && fl.includes(tok)) score += 5;
      }
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return bestScore > 0 ? best : null;
  }

  // ───── Tools (parameterized queries) ─────────────────────
  const tools = {
    volume_by_facility({ period = "this_month" } = {}) {
      const range = periodRange(period);
      const map = new Map();
      for (const t of TRIPS) {
        if (!inRange(t, range)) continue;
        if (!map.has(t.facility)) map.set(t.facility, { facility: t.facility, completed: 0, total: 0 });
        const row = map.get(t.facility);
        row.total++;
        if (t.status === "completed") row.completed++;
      }
      const rows = [...map.values()].sort((a, b) => b.completed - a.completed);
      return { period: range.label, rows };
    },

    trend({ facility, weeks = 8 } = {}) {
      const fac = resolveFacility(facility);
      if (!fac) return { error: `No facility matches "${facility}".`, suggestions: FACILITIES };
      const buckets = [];
      for (let w = weeks - 1; w >= 0; w--) {
        const end = new Date(NOW.getTime() - w * 7 * 24 * 3600 * 1000);
        const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
        buckets.push({
          week_ending: end.toISOString().slice(0, 10),
          completed: 0,
          canceled: 0,
        });
      }
      for (const t of TRIPS) {
        if (t.facility !== fac) continue;
        const d = new Date(t.scheduled_pickup_at);
        for (const b of buckets) {
          const end = new Date(b.week_ending + "T00:00:00Z");
          const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
          if (d >= start && d < end) {
            if (t.status === "completed") b.completed++;
            else if (t.status === "canceled") b.canceled++;
            break;
          }
        }
      }
      return { facility: fac, rows: buckets };
    },

    cancellations({ period = "this_month", by_facility = true } = {}) {
      const range = periodRange(period);
      if (!by_facility) {
        let canceled = 0, total = 0;
        for (const t of TRIPS) {
          if (!inRange(t, range)) continue;
          total++;
          if (t.status === "canceled") canceled++;
        }
        return {
          period: range.label,
          rows: [{
            scope: "All facilities",
            canceled, total,
            rate_pct: total ? Math.round((canceled / total) * 1000) / 10 : 0,
          }],
        };
      }
      const map = new Map();
      for (const t of TRIPS) {
        if (!inRange(t, range)) continue;
        if (!map.has(t.facility)) map.set(t.facility, { facility: t.facility, canceled: 0, total: 0 });
        const row = map.get(t.facility);
        row.total++;
        if (t.status === "canceled") row.canceled++;
      }
      const rows = [...map.values()].map(r => ({
        ...r, rate_pct: r.total ? Math.round((r.canceled / r.total) * 1000) / 10 : 0,
      })).sort((a, b) => b.rate_pct - a.rate_pct);
      return { period: range.label, rows };
    },

    revenue({ period = "this_month", facility = null } = {}) {
      const range = periodRange(period);
      const fac = facility ? resolveFacility(facility) : null;
      if (facility && !fac) return { error: `No facility matches "${facility}".`, suggestions: FACILITIES };

      if (fac) {
        let cents = 0, trips = 0;
        for (const t of TRIPS) {
          if (!inRange(t, range)) continue;
          if (t.facility !== fac) continue;
          if (t.status !== "completed") continue;
          cents += t.price_cents; trips++;
        }
        return {
          period: range.label,
          rows: [{
            facility: fac,
            revenue_usd: Math.round(cents / 100),
            completed_trips: trips,
            avg_trip_usd: trips ? Math.round(cents / trips / 100) : 0,
          }],
        };
      }
      const map = new Map();
      for (const t of TRIPS) {
        if (!inRange(t, range)) continue;
        if (t.status !== "completed") continue;
        if (!map.has(t.facility)) map.set(t.facility, { facility: t.facility, revenue_cents: 0, trips: 0 });
        const row = map.get(t.facility);
        row.revenue_cents += t.price_cents; row.trips++;
      }
      const rows = [...map.values()].map(r => ({
        facility: r.facility,
        revenue_usd: Math.round(r.revenue_cents / 100),
        completed_trips: r.trips,
        avg_trip_usd: r.trips ? Math.round(r.revenue_cents / r.trips / 100) : 0,
      })).sort((a, b) => b.revenue_usd - a.revenue_usd);
      return { period: range.label, rows };
    },

    service_mix({ facility = null, period = "last_30_days" } = {}) {
      const range = periodRange(period);
      const fac = facility ? resolveFacility(facility) : null;
      if (facility && !fac) return { error: `No facility matches "${facility}".`, suggestions: FACILITIES };

      const counts = { STR: 0, WC: 0, AMB: 0 };
      let total = 0;
      for (const t of TRIPS) {
        if (!inRange(t, range)) continue;
        if (fac && t.facility !== fac) continue;
        if (t.status !== "completed") continue;
        counts[t.service_class]++; total++;
      }
      const rows = ["STR", "WC", "AMB"].map(k => ({
        service_class: k,
        label: k === "STR" ? "Stretcher" : k === "WC" ? "Wheelchair" : "Ambulatory",
        completed: counts[k],
        pct: total ? Math.round((counts[k] / total) * 1000) / 10 : 0,
      }));
      return { scope: fac || "All facilities", period: range.label, rows };
    },

    facilities_down({ period = "this_month" } = {}) {
      // Compare current period vs prior equal-length period.
      const cur = periodRange(period);
      const durationMs = cur.end - cur.start;
      const priorEnd = new Date(cur.start.getTime());
      const priorStart = new Date(priorEnd.getTime() - durationMs);
      const prior = { start: priorStart, end: priorEnd, label: "prior period" };

      const curMap = new Map(), priorMap = new Map();
      for (const t of TRIPS) {
        if (t.status !== "completed") continue;
        if (inRange(t, cur)) curMap.set(t.facility, (curMap.get(t.facility) || 0) + 1);
        if (inRange(t, prior)) priorMap.set(t.facility, (priorMap.get(t.facility) || 0) + 1);
      }
      const rows = FACILITIES.map(f => {
        const c = curMap.get(f) || 0;
        const p = priorMap.get(f) || 0;
        const change = c - p;
        const change_pct = p > 0 ? Math.round((change / p) * 1000) / 10 : null;
        return { facility: f, current: c, prior: p, change, change_pct };
      }).sort((a, b) => (a.change_pct ?? 0) - (b.change_pct ?? 0));
      return { period: cur.label, comparison: "prior equal-length period", rows };
    },
  };

  async function mockQuery({ tool, args }) {
    // Simulate network latency
    await new Promise(r => setTimeout(r, 320 + Math.random() * 280));
    const fn = tools[tool];
    if (!fn) return { error: `Unknown tool "${tool}".` };
    try {
      return fn(args || {});
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }

  window.SunStateMock = {
    FACILITIES,
    query: mockQuery,
    tripsCount: TRIPS.length,
  };
})();
