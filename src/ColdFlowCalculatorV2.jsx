import React, { useMemo, useState } from "react";
import {
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from "lucide-react";

/* =========================
   Helpers
========================= */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatInt(n) {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

function formatPct(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return `${Number(n).toFixed(digits)}%`;
}

function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function countWeekdaysExclusive(startDate, endDate) {
  if (!isValidDate(startDate) || !isValidDate(endDate)) return 0;
  if (endDate <= startDate) return 0;

  let count = 0;
  let d = addDays(startDate, 1);

  while (d <= endDate) {
    if (isWeekday(d)) count += 1;
    d = addDays(d, 1);
  }

  return count;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDDMMYYYY(date) {
  if (!isValidDate(date)) return "";
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function parseDDMMYYYY(s) {
  if (!s) return null;
  const cleaned = String(s).trim();
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);

  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
    return null;
  }

  return d;
}

function normalizeDateInput(value) {
  const d = parseDDMMYYYY(value);
  return d ? formatDDMMYYYY(d) : value;
}

function safeDivide(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Infinity;
  return a / b;
}

/* =========================
   Component
========================= */
export default function ColdFlowCalculatorV3() {
  // Event target -> work backwards
  const [eventAttendanceTarget, setEventAttendanceTarget] = useState(10000);
  const [ticketConversionPct, setTicketConversionPct] = useState(2);

  // Cold data into flow
  const [monthStartData, setMonthStartData] = useState(160000);
  const [goodEmailablePct, setGoodEmailablePct] = useState(80);
  const [duplicateRate, setDuplicateRate] = useState(1);

  // Fixed sending constraints
  const [dailySendCapacity, setDailySendCapacity] = useState(7500);
  const [workdaysPerMonth, setWorkdaysPerMonth] = useState(20);

  // HubSpot + warm flow rates
  const [openAndPassedPct, setOpenAndPassedPct] = useState(51);
  const [warmingRatePct, setWarmingRatePct] = useState(80);
  const [staysWarmPct, setStaysWarmPct] = useState(85);

  // Current totals
  const [hubspotSoFar, setHubspotSoFar] = useState(120000);
  const [warmPoolSoFar, setWarmPoolSoFar] = useState(60000);

  // Scenario band
  const [worstMult, setWorstMult] = useState(0.8);
  const [expectedMult, setExpectedMult] = useState(1.0);
  const [bestMult, setBestMult] = useState(1.15);

  // Dates
  const today = useMemo(() => new Date(), []);
  const defaultTarget = useMemo(() => {
    const x = new Date();
    x.setMonth(x.getMonth() + 2);
    return x;
  }, []);

  const [startDateText, setStartDateText] = useState(formatDDMMYYYY(today));
  const [targetDateText, setTargetDateText] = useState(formatDDMMYYYY(defaultTarget));

  const startDate = useMemo(() => parseDDMMYYYY(startDateText), [startDateText]);
  const targetDate = useMemo(() => parseDDMMYYYY(targetDateText), [targetDateText]);

  // Optional segments
  const [showSegments, setShowSegments] = useState(false);
  const [segments, setSegments] = useState([
    { id: 1, name: "Banks", pct: 20, locked: false },
    { id: 2, name: "Asset Managers", pct: 15, locked: false },
    { id: 3, name: "Insurers", pct: 10, locked: false },
    { id: 4, name: "Other", pct: 55, locked: true },
  ]);

  const rebalanceSegments = (list) => {
    const locked = list.find((s) => s.locked);
    if (!locked) return list;

    const editableTotal = list
      .filter((s) => !s.locked)
      .reduce((sum, s) => sum + Number(s.pct || 0), 0);

    const remainder = Math.max(0, 100 - editableTotal);

    return list.map((s) =>
      s.locked ? { ...s, pct: remainder } : s
    );
  };

  const addSegment = () => {
    setSegments((prev) => {
      const unlocked = prev.filter((s) => !s.locked);
      const locked = prev.find((s) => s.locked);

      if (!locked) return prev;

      const next = [
        ...unlocked,
        {
          id: Date.now(),
          name: `Segment ${unlocked.length + 1}`,
          pct: 0,
          locked: false,
        },
        locked,
      ];

      return rebalanceSegments(next);
    });
  };

  const updateSegment = (id, field, value) => {
    setSegments((prev) => {
      const next = prev.map((segment) =>
        segment.id === id
          ? {
              ...segment,
              [field]: field === "pct" ? Number(value) : value,
            }
          : segment
      );

      return rebalanceSegments(next);
    });
  };

  const removeSegment = (id) => {
    setSegments((prev) => {
      const next = prev.filter((segment) => segment.id !== id);
      return rebalanceSegments(next);
    });
  };

  const model = useMemo(() => {
    // Work backwards from attendees
    const requiredHubspotTarget =
      ticketConversionPct > 0
        ? eventAttendanceTarget / (ticketConversionPct / 100)
        : Infinity;

    // Monthly snapshot funnel
    const emailable = monthStartData * (goodEmailablePct / 100);
    const usableAfterDedup = Math.max(0, emailable * (1 - duplicateRate / 100));

    const monthlyCapacity = dailySendCapacity * workdaysPerMonth;
    const sendableThisMonth = Math.min(usableAfterDedup, monthlyCapacity);

    const addedToHubspotThisMonth = sendableThisMonth * (openAndPassedPct / 100);
    const warmedThisMonth = addedToHubspotThisMonth * (warmingRatePct / 100);
    const warmAddedThisMonth = warmedThisMonth * (staysWarmPct / 100);

    const totalHubspotAfterThisMonth = hubspotSoFar + addedToHubspotThisMonth;
    const warmPoolAfterThisMonth = warmPoolSoFar + warmAddedThisMonth;

    // Planning window
    const s = startDate && isValidDate(startDate) ? startDate : null;
    const t = targetDate && isValidDate(targetDate) ? targetDate : null;

    const workdaysRemaining = s && t ? countWeekdaysExclusive(s, t) : 0;
    const hubspotNamesStillNeeded = Math.max(0, requiredHubspotTarget - hubspotSoFar);

    const requiredHubspotAddedPerDay =
      workdaysRemaining > 0 ? hubspotNamesStillNeeded / workdaysRemaining : 0;

    const hubspotFromSendRate = openAndPassedPct / 100;
    const requiredSendPerDay = safeDivide(requiredHubspotAddedPerDay, hubspotFromSendRate);

    const capacitySendPerDay = dailySendCapacity;
    const baseAchievableHubspotPerDay = capacitySendPerDay * hubspotFromSendRate;
    const baseAchievableWarmPerDay =
      baseAchievableHubspotPerDay *
      (warmingRatePct / 100) *
      (staysWarmPct / 100);

    const capacityOK = requiredSendPerDay <= capacitySendPerDay;

    const scenarios = [
      { key: "worst", label: "Worst case", mult: worstMult },
      { key: "expected", label: "Expected", mult: expectedMult },
      { key: "best", label: "Best case", mult: bestMult },
    ].map((sc) => {
      const achievableHubspotPerDay = baseAchievableHubspotPerDay * sc.mult;
      const achievableWarmPerDay = baseAchievableWarmPerDay * sc.mult;

      const daysToHubspotTarget =
        achievableHubspotPerDay > 0
          ? Math.ceil(hubspotNamesStillNeeded / achievableHubspotPerDay)
          : Infinity;

      return {
        ...sc,
        achievableHubspotPerDay,
        achievableWarmPerDay,
        daysToHubspotTarget,
        onTrack: achievableHubspotPerDay >= requiredHubspotAddedPerDay,
      };
    });

    const effectiveConversionToWarm =
      (goodEmailablePct / 100) *
      (1 - duplicateRate / 100) *
      (openAndPassedPct / 100) *
      (warmingRatePct / 100) *
      (staysWarmPct / 100);

    const segmentBreakdown = segments.map((segment) => ({
      ...segment,
      targetHubspotCount: requiredHubspotTarget * (segment.pct / 100),
      currentHubspotCount: hubspotSoFar * (segment.pct / 100),
      warmPoolCount: warmPoolAfterThisMonth * (segment.pct / 100),
    }));

    return {
      requiredHubspotTarget,

      emailable,
      usableAfterDedup,
      monthlyCapacity,
      sendableThisMonth,
      addedToHubspotThisMonth,
      warmedThisMonth,
      warmAddedThisMonth,

      totalHubspotAfterThisMonth,
      warmPoolAfterThisMonth,

      workdaysRemaining,
      hubspotNamesStillNeeded,
      requiredHubspotAddedPerDay,
      requiredSendPerDay,
      capacitySendPerDay,
      baseAchievableHubspotPerDay,
      baseAchievableWarmPerDay,
      capacityOK,

      effectiveConversionToWarm,

      scenarios,

      segmentBreakdown,
    };
  }, [
    eventAttendanceTarget,
    ticketConversionPct,
    monthStartData,
    goodEmailablePct,
    duplicateRate,
    dailySendCapacity,
    workdaysPerMonth,
    openAndPassedPct,
    warmingRatePct,
    staysWarmPct,
    hubspotSoFar,
    warmPoolSoFar,
    worstMult,
    expectedMult,
    bestMult,
    startDate,
    targetDate,
    segments,
  ]);

  const funnelStages = useMemo(() => {
    return [
      { label: "Cold data into flow this month", value: monthStartData },
      {
        label: `Good / emailable (${goodEmailablePct}%)`,
        value: model.emailable,
      },
      {
        label: `After dedupe (${duplicateRate}% duplicate rate)`,
        value: model.usableAfterDedup,
      },
      {
        label: "Actually sendable this month",
        value: model.sendableThisMonth,
      },
      {
        label: `Added to HubSpot (${openAndPassedPct}%)`,
        value: model.addedToHubspotThisMonth,
      },
      {
        label: `Warmed (${warmingRatePct}%)`,
        value: model.warmedThisMonth,
      },
      {
        label: `Stays warm (${staysWarmPct}%)`,
        value: model.warmAddedThisMonth,
      },
    ];
  }, [
    monthStartData,
    goodEmailablePct,
    duplicateRate,
    openAndPassedPct,
    warmingRatePct,
    staysWarmPct,
    model,
  ]);

  const maxValue = Math.max(...funnelStages.map((s) => s.value), 1) * 1.1;

  return (
    <div className="container">
      <div className="header">
        <h1 className="title">Cold Flow Calculator (v3)</h1>
        <p className="subtitle">
          Work backwards from event attendance → required HubSpot target → cold flow → warm pool growth.
        </p>
      </div>

      <div className="grid">
        {/* LEFT — Inputs */}
        <div className="section">
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">
                <TrendingDown /> <span>Targets & Inputs</span>
              </div>
              <span className="badge">Plan</span>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">Event attendance target</span>
                  <span className="value">{formatInt(eventAttendanceTarget)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="50000"
                  step="100"
                  value={eventAttendanceTarget}
                  onChange={(e) => setEventAttendanceTarget(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <div className="fieldTop">
                  <span className="label">% of total HubSpot that buys tickets</span>
                  <span className="value">{formatPct(ticketConversionPct, 1)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={ticketConversionPct}
                  onChange={(e) => setTicketConversionPct(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="cardHeader" style={{ marginTop: 6 }}>
              <div className="cardTitle">Cold flow input</div>
              <span className="badge">Cold</span>
            </div>

            <div className="field">
              <div className="fieldTop">
                <span className="label">Data into cold flow start of month</span>
                <span className="value">{formatInt(monthStartData)}</span>
              </div>
              <input
                className="range"
                type="range"
                min="0"
                max="2000000"
                step="5000"
                value={monthStartData}
                onChange={(e) => setMonthStartData(Number(e.target.value))}
              />
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">% with good/emailable names</span>
                  <span className="value">{formatPct(goodEmailablePct, 0)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={goodEmailablePct}
                  onChange={(e) => setGoodEmailablePct(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <div className="fieldTop">
                  <span className="label">% duplicate rate</span>
                  <span className="value">{formatPct(duplicateRate, 1)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="50"
                  step="0.1"
                  value={duplicateRate}
                  onChange={(e) => setDuplicateRate(Number(e.target.value))}
                />
                <div className="muted">More campaigns usually = more overlap</div>
              </div>
            </div>

            <div className="cardHeader" style={{ marginTop: 6 }}>
              <div className="cardTitle">Sending (fixed)</div>
              <span className="badge">Capacity</span>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">Daily send capacity</span>
                  <span className="value">{formatInt(dailySendCapacity)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="20000"
                  step="50"
                  value={dailySendCapacity}
                  onChange={(e) => setDailySendCapacity(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <div className="fieldTop">
                  <span className="label">Workdays per month</span>
                  <span className="value">{workdaysPerMonth}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="1"
                  max="23"
                  step="1"
                  value={workdaysPerMonth}
                  onChange={(e) => setWorkdaysPerMonth(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="cardHeader" style={{ marginTop: 6 }}>
              <div className="cardTitle">HubSpot & warm flow</div>
              <span className="badge">Warm</span>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">% opened & passed to HubSpot</span>
                  <span className="value">{formatPct(openAndPassedPct, 0)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={openAndPassedPct}
                  onChange={(e) => setOpenAndPassedPct(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <div className="fieldTop">
                  <span className="label">% that enters warming</span>
                  <span className="value">{formatPct(warmingRatePct, 0)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={warmingRatePct}
                  onChange={(e) => setWarmingRatePct(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <div className="fieldTop">
                  <span className="label">% that stays warm</span>
                  <span className="value">{formatPct(staysWarmPct, 0)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={staysWarmPct}
                  onChange={(e) => setStaysWarmPct(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="cardHeader" style={{ marginTop: 6 }}>
              <div className="cardTitle">Current totals</div>
              <span className="badge">Base</span>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">Names in HubSpot now</span>
                  <span className="value">{formatInt(hubspotSoFar)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="1000000"
                  step="1000"
                  value={hubspotSoFar}
                  onChange={(e) => setHubspotSoFar(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <div className="fieldTop">
                  <span className="label">Warm pool now</span>
                  <span className="value">{formatInt(warmPoolSoFar)}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="1000000"
                  step="1000"
                  value={warmPoolSoFar}
                  onChange={(e) => setWarmPoolSoFar(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — Results */}
        <div className="section">
          <div className="kpiGrid">
            <div className="kpi">
              <div className="kpiKicker">Required total HubSpot database</div>
              <div className="kpiValue kpiValue--hot">
                {formatInt(model.requiredHubspotTarget)}
              </div>
            </div>

            <div className="kpi">
              <div className="kpiKicker">HubSpot added this month</div>
              <div className="kpiValue">{formatInt(model.addedToHubspotThisMonth)}</div>
            </div>

            <div className="kpi">
              <div className="kpiKicker">Warm added this month</div>
              <div className="kpiValue kpiValue--good">
                {formatInt(model.warmAddedThisMonth)}
              </div>
            </div>

            <div className="kpi">
              <div className="kpiKicker">Warm pool after this month</div>
              <div className="kpiValue">{formatInt(model.warmPoolAfterThisMonth)}</div>
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">Monthly funnel snapshot</div>
              <span className="badge">This month</span>
            </div>

            <div>
              {funnelStages.map((stage, idx) => {
                const pct = (stage.value / maxValue) * 100;
                return (
                  <div key={idx} style={{ marginBottom: 12 }}>
                    <div className="barTop">
                      <div className="barLabel">{stage.label}</div>
                      <div className="barNum">{formatInt(stage.value)}</div>
                    </div>
                    <div className="barWrap">
                      <div
                        className="barFill"
                        style={{ width: `${clamp(pct, 0, 100)}%` }}
                      >
                        {pct > 10 && (
                          <span className="barPill">{pct.toFixed(0)}%</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">
                Build {formatInt(model.requiredHubspotTarget)} HubSpot names by{" "}
                {targetDateText || "DD/MM/YYYY"}
              </div>
              <span className="badge badge--hot">Plan</span>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">Start date (DD/MM/YYYY)</span>
                  <span className="muted">Weekdays-only</span>
                </div>
                <input
                  type="text"
                  value={startDateText}
                  onChange={(e) => setStartDateText(e.target.value)}
                  onBlur={(e) => setStartDateText(normalizeDateInput(e.target.value))}
                  placeholder="DD/MM/YYYY"
                />
                <div className="muted">
                  {startDate ? "✓ Valid" : "Enter e.g. 02/03/2026"}
                </div>
              </div>

              <div className="field">
                <div className="fieldTop">
                  <span className="label">Target date (DD/MM/YYYY)</span>
                  <span className="muted">Deadline</span>
                </div>
                <input
                  type="text"
                  value={targetDateText}
                  onChange={(e) => setTargetDateText(e.target.value)}
                  onBlur={(e) => setTargetDateText(normalizeDateInput(e.target.value))}
                  placeholder="DD/MM/YYYY"
                />
                <div className="muted">
                  {targetDate ? "✓ Valid" : "Enter e.g. 01/04/2026"}
                </div>
              </div>
            </div>

            <div className="twoCol" style={{ marginTop: 12 }}>
              <div className="stat">
                <div className="statKicker">Workdays remaining</div>
                <div className="statNum">{formatInt(model.workdaysRemaining)}</div>
              </div>

              <div className="stat">
                <div className="statKicker">HubSpot names still needed</div>
                <div className="statNum">{formatInt(model.hubspotNamesStillNeeded)}</div>
              </div>

              <div className="stat">
                <div className="statKicker">Required HubSpot added / workday</div>
                <div className="statNum">{formatInt(model.requiredHubspotAddedPerDay)}</div>
              </div>

              <div className="stat">
                <div className="statKicker">Required send / workday</div>
                <div className="statNum">{formatInt(model.requiredSendPerDay)}</div>
              </div>

              <div className="stat">
                <div className="statKicker">Send capacity / workday (fixed)</div>
                <div className="statNum">{formatInt(model.capacitySendPerDay)}</div>
              </div>

              <div className="stat">
                <div className="statKicker">Expected warm added / workday</div>
                <div className="statNum">{formatInt(model.baseAchievableWarmPerDay)}</div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 14 }}>
              <div className="cardHeader">
                <div className="cardTitle">Scenario range</div>
                <span className="badge">Band</span>
              </div>

              <div className="twoCol">
                <div className="field">
                  <div className="fieldTop">
                    <span className="label">Worst</span>
                    <span className="value">{Math.round(worstMult * 100)}%</span>
                  </div>
                  <input
                    className="range"
                    type="range"
                    min="0.5"
                    max="1.2"
                    step="0.01"
                    value={worstMult}
                    onChange={(e) => setWorstMult(Number(e.target.value))}
                  />
                </div>

                <div className="field">
                  <div className="fieldTop">
                    <span className="label">Expected</span>
                    <span className="value">{Math.round(expectedMult * 100)}%</span>
                  </div>
                  <input
                    className="range"
                    type="range"
                    min="0.7"
                    max="1.3"
                    step="0.01"
                    value={expectedMult}
                    onChange={(e) => setExpectedMult(Number(e.target.value))}
                  />
                </div>

                <div className="field">
                  <div className="fieldTop">
                    <span className="label">Best</span>
                    <span className="value">{Math.round(bestMult * 100)}%</span>
                  </div>
                  <input
                    className="range"
                    type="range"
                    min="0.8"
                    max="1.6"
                    step="0.01"
                    value={bestMult}
                    onChange={(e) => setBestMult(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            <div className="callout" style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>
                Scenario forecast
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 720,
                  }}
                >
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "10px 8px", color: "rgba(255,255,255,0.7)" }}>
                        Scenario
                      </th>
                      <th style={{ textAlign: "right", padding: "10px 8px", color: "rgba(255,255,255,0.7)" }}>
                        HubSpot added/day
                      </th>
                      <th style={{ textAlign: "right", padding: "10px 8px", color: "rgba(255,255,255,0.7)" }}>
                        Warm added/day
                      </th>
                      <th style={{ textAlign: "right", padding: "10px 8px", color: "rgba(255,255,255,0.7)" }}>
                        Days to HubSpot target
                      </th>
                      <th style={{ textAlign: "right", padding: "10px 8px", color: "rgba(255,255,255,0.7)" }}>
                        Status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {model.scenarios.map((s) => (
                      <tr
                        key={s.key}
                        style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <td style={{ padding: "10px 8px", fontWeight: 800 }}>
                          {s.label}
                        </td>

                        <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 900 }}>
                          {formatInt(s.achievableHubspotPerDay)}
                        </td>

                        <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 900 }}>
                          {formatInt(s.achievableWarmPerDay)}
                        </td>

                        <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 900 }}>
                          {Number.isFinite(s.daysToHubspotTarget)
                            ? formatInt(s.daysToHubspotTarget)
                            : "—"}
                        </td>

                        <td
                          style={{
                            padding: "10px 8px",
                            textAlign: "right",
                            fontWeight: 900,
                            color: s.onTrack
                              ? "var(--good,#7CFFB2)"
                              : "var(--warn,#FFB9A0)",
                          }}
                        >
                          {s.onTrack ? "ON TRACK" : "OFF TRACK"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                <li>
                  Required send/day: <b>{formatInt(model.requiredSendPerDay)}</b> vs capacity/day{" "}
                  <b>{formatInt(model.capacitySendPerDay)}</b>{" "}
                  <b
                    style={{
                      color: model.capacityOK
                        ? "var(--good,#7CFFB2)"
                        : "var(--warn,#FFB9A0)",
                    }}
                  >
                    {model.capacityOK ? " (OK)" : " (NEEDS CAPACITY)"}
                  </b>
                </li>
                <li>
                  Required HubSpot added/day: <b>{formatInt(model.requiredHubspotAddedPerDay)}</b>
                </li>
              </ul>
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">Segments (optional)</div>
              <button
                type="button"
                onClick={() => setShowSegments((prev) => !prev)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span className="badge">{showSegments ? "Hide" : "Show"}</span>
                {showSegments ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {showSegments && (
              <>
                <div className="smallNote" style={{ marginBottom: 12 }}>
                  Use this to split your required HubSpot target and warm pool into ICP groups.
                </div>

                <div className="smallNote" style={{ marginBottom: 12 }}>
                  Total segment %: <b>100%</b>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  {segments.map((segment) => (
                    <div
                      key={segment.id}
                      style={{
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 12,
                        padding: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.2fr 0.8fr auto",
                          gap: 10,
                          alignItems: "end",
                          marginBottom: 10,
                        }}
                      >
                        <div>
                          <div className="label" style={{ marginBottom: 6 }}>
                            Segment name
                          </div>
                          <input
                            type="text"
                            value={segment.name}
                            onChange={(e) =>
                              updateSegment(segment.id, "name", e.target.value)
                            }
                            placeholder="Segment name"
                            disabled={segment.locked}
                          />
                        </div>

                        <div>
                          <div className="label" style={{ marginBottom: 6 }}>
                            Segment percentage
                          </div>
                          <input
                            type="text"
                            value={segment.pct}
                            onChange={(e) =>
                              updateSegment(segment.id, "pct", e.target.value)
                            }
                            placeholder="%"
                            disabled={segment.locked}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => removeSegment(segment.id)}
                          disabled={segment.locked}
                          style={{
                            background: "transparent",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 10,
                            padding: "8px 10px",
                            color: "inherit",
                            cursor: segment.locked ? "not-allowed" : "pointer",
                            opacity: segment.locked ? 0.5 : 1,
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="twoCol">
                        <div className="stat">
                          <div className="statKicker">Target HubSpot names</div>
                          <div className="statNum">
                            {formatInt(segment.pct * model.requiredHubspotTarget / 100)}
                          </div>
                        </div>

                        <div className="stat">
                          <div className="statKicker">Warm pool share</div>
                          <div className="statNum">
                            {formatInt(segment.pct * model.warmPoolAfterThisMonth / 100)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addSegment}
                  style={{
                    marginTop: 12,
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    color: "inherit",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Plus size={16} />
                  Add segment
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
