import React, { useMemo, useState } from "react";
import { TrendingDown } from "lucide-react";

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
function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}
function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5; // Mon..Fri
}
function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function countWeekdaysExclusive(startDate, endDate) {
  // weekdays from startDate (exclusive) to endDate (inclusive)
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
  return `${pad2(date.getDate())}/${pad2(
    date.getMonth() + 1
  )}/${date.getFullYear()}`;
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
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd)
    return null;
  return d;
}
function normalizeDateInput(value) {
  const d = parseDDMMYYYY(value);
  return d ? formatDDMMYYYY(d) : value;
}

/* =========================
   Component
========================= */
export default function ColdFlowCalculatorV2() {
  // Pool + rates
  const [monthStartData, setMonthStartData] = useState(160000);
  const [goodEmailablePct, setGoodEmailablePct] = useState(80);
  const [duplicateRate, setDuplicateRate] = useState(1);

  // Fixed sending constraints
  const [dailySendCapacity, setDailySendCapacity] = useState(7500);
  const [workdaysPerMonth, setWorkdaysPerMonth] = useState(20);

  // Downstream rates
  const [openAndPassedPct, setOpenAndPassedPct] = useState(51);
  const [nurtureEngagedPct, setNurtureEngagedPct] = useState(100);

  // HubSpot totals + target
  const [hubspotSoFar, setHubspotSoFar] = useState(120000);
  const [hubspotTarget, setHubspotTarget] = useState(500000);

  // Scenario band (multipliers around achievable kept/day)
  const [worstMult, setWorstMult] = useState(0.8);
  const [expectedMult, setExpectedMult] = useState(1.0);
  const [bestMult, setBestMult] = useState(1.15);

  // Dates (DD/MM/YYYY)
  const today = useMemo(() => new Date(), []);
  const defaultTarget = useMemo(() => {
    const x = new Date();
    x.setMonth(x.getMonth() + 2);
    return x;
  }, []);

  const [startDateText, setStartDateText] = useState(formatDDMMYYYY(today));
  const [targetDateText, setTargetDateText] = useState(
    formatDDMMYYYY(defaultTarget)
  );

  const startDate = useMemo(
    () => parseDDMMYYYY(startDateText),
    [startDateText]
  );
  const targetDate = useMemo(
    () => parseDDMMYYYY(targetDateText),
    [targetDateText]
  );

  const model = useMemo(() => {
    // Monthly snapshot funnel
    const emailable = monthStartData * (goodEmailablePct / 100);
    const usableAfterDedup = Math.max(0, emailable * (1 - duplicateRate / 100));

    const monthlyCapacity = dailySendCapacity * workdaysPerMonth;
    const sendableThisMonth = Math.min(usableAfterDedup, monthlyCapacity);

    const openedAndPassed = sendableThisMonth * (openAndPassedPct / 100);
    const kept = openedAndPassed * (nurtureEngagedPct / 100);

    const totalHubspotAfterThisMonth = hubspotSoFar + kept;

    // Planning window
    const s = startDate && isValidDate(startDate) ? startDate : null;
    const t = targetDate && isValidDate(targetDate) ? targetDate : null;

    const workdaysRemaining = s && t ? countWeekdaysExclusive(s, t) : 0;
    const namesStillNeeded = Math.max(0, hubspotTarget - hubspotSoFar);

    // Required kept/day to hit target by date
    const requiredKeptPerDay =
      workdaysRemaining > 0 ? namesStillNeeded / workdaysRemaining : 0;

    // Given the downstream %s, how much send/day does that require?
    const keptFromSendRate =
      (openAndPassedPct / 100) * (nurtureEngagedPct / 100);

    const requiredSendPerDay =
      keptFromSendRate > 0 ? requiredKeptPerDay / keptFromSendRate : Infinity;

    // Capacity is fixed
    const capacitySendPerDay = dailySendCapacity;

    // Achievable kept/day at current settings (capacity × rates)
    const baseAchievableKeptPerDay = capacitySendPerDay * keptFromSendRate;

    // Scenario band
    const scenarios = [
      { key: "worst", label: "Worst case", mult: worstMult },
      { key: "expected", label: "Expected", mult: expectedMult },
      { key: "best", label: "Best case", mult: bestMult },
    ].map((sc) => {
      const achievableKeptPerDay = baseAchievableKeptPerDay * sc.mult;

      const daysToTarget =
        achievableKeptPerDay > 0
          ? Math.ceil(namesStillNeeded / achievableKeptPerDay)
          : Infinity;

      const onTrack = achievableKeptPerDay >= requiredKeptPerDay;
      const capacityOK = requiredSendPerDay <= capacitySendPerDay;

      return {
        ...sc,
        achievableKeptPerDay,
        daysToTarget,
        onTrack,
        capacityOK,
      };
    });

    const effectiveConversion =
      (goodEmailablePct / 100) *
      (1 - duplicateRate / 100) *
      (openAndPassedPct / 100) *
      (nurtureEngagedPct / 100);

    return {
      // Monthly snapshot
      emailable,
      usableAfterDedup,
      monthlyCapacity,
      sendableThisMonth,
      openedAndPassed,
      kept,
      totalHubspotAfterThisMonth,
      effectiveConversion,

      // Planning essentials
      workdaysRemaining,
      namesStillNeeded,
      requiredKeptPerDay,
      requiredSendPerDay,
      capacitySendPerDay,
      baseAchievableKeptPerDay,

      // Scenarios
      scenarios,
    };
  }, [
    monthStartData,
    goodEmailablePct,
    duplicateRate,
    dailySendCapacity,
    workdaysPerMonth,
    openAndPassedPct,
    nurtureEngagedPct,
    hubspotSoFar,
    hubspotTarget,
    worstMult,
    expectedMult,
    bestMult,
    startDate,
    targetDate,
  ]);

  const funnelStages = useMemo(() => {
    return [
      { label: "Data at start of month", value: monthStartData },
      {
        label: `Good / emailable (${goodEmailablePct}%)`,
        value: model.emailable,
      },
      {
        label: `After dedupe (${duplicateRate}% duplicate rate)`,
        value: model.usableAfterDedup,
      },
      {
        label: `Send capacity this month (${formatInt(
          dailySendCapacity
        )}/day × ${workdaysPerMonth} days)`,
        value: model.monthlyCapacity,
      },
      { label: "Actually sendable this month", value: model.sendableThisMonth },
      {
        label: `Opened + passed to HubSpot (${openAndPassedPct}%)`,
        value: model.openedAndPassed,
      },
      {
        label: `Engaged nurture / kept (${nurtureEngagedPct}%)`,
        value: model.kept,
      },
    ];
  }, [
    monthStartData,
    goodEmailablePct,
    duplicateRate,
    dailySendCapacity,
    workdaysPerMonth,
    openAndPassedPct,
    nurtureEngagedPct,
    model,
  ]);

  const maxValue = Math.max(...funnelStages.map((s) => s.value), 1) * 1.1;

  return (
    <div className="container">
      <div className="header">
        <h1 className="title">Cold Flow Calculator (v2)</h1>
        <p className="subtitle">
          Snapshot your monthly funnel + plan “Build X by date” with a realistic
          Worst/Expected/Best band.
        </p>
      </div>

      <div className="grid">
        {/* LEFT — Inputs */}
        <div className="section">
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">
                <TrendingDown /> <span>Inputs</span>
              </div>
              <span className="badge">Rates</span>
            </div>

            <div className="field">
              <div className="fieldTop">
                <span className="label">Data into coldflow start of month</span>
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
              <div className="muted">Raw names available this month</div>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">% with good/emailable names</span>
                  <span className="value">{goodEmailablePct}%</span>
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
                  <span className="value">{duplicateRate}%</span>
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
                <div className="muted">
                  “no of campaigns increases duplicates”
                </div>
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
              <div className="cardTitle">HubSpot & Nurture</div>
              <span className="badge">Flow</span>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">% opened & passed to HubSpot</span>
                  <span className="value">{openAndPassedPct}%</span>
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
                  <span className="label">
                    % that engage with nurture flows (kept)
                  </span>
                  <span className="value">{nurtureEngagedPct}%</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={nurtureEngagedPct}
                  onChange={(e) => setNurtureEngagedPct(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="cardHeader" style={{ marginTop: 6 }}>
              <div className="cardTitle">Targets</div>
              <span className="badge">Goal</span>
            </div>

            <div className="twoCol">
              <div className="field">
                <div className="fieldTop">
                  <span className="label">Names in HubSpot</span>
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
                  <span className="label">HubSpot target total</span>
                  <span className="value value--hot">
                    {formatInt(hubspotTarget)}
                  </span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="3000000"
                  step="10000"
                  value={hubspotTarget}
                  onChange={(e) => setHubspotTarget(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — Results */}
        <div className="section">
          {/* Monthly snapshot funnel */}
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

          {/* KPIs */}
          <div className="kpiGrid">
            <div className="kpi">
              <div className="kpiKicker">Kept this month</div>
              <div className="kpiValue kpiValue--good">
                {formatInt(model.kept)}
              </div>
            </div>

            <div className="kpi">
              <div className="kpiKicker">HubSpot total after this month</div>
              <div className="kpiValue">
                {formatInt(model.totalHubspotAfterThisMonth)}
              </div>
            </div>

            <div className="kpi">
              <div className="kpiKicker">Monthly send capacity</div>
              <div className="kpiValue kpiValue--hot">
                {formatInt(model.monthlyCapacity)}
              </div>
            </div>

            <div className="kpi">
              <div className="kpiKicker">Effective conversion (raw → kept)</div>
              <div className="kpiValue">
                {(model.effectiveConversion * 100).toFixed(3)}%
              </div>
            </div>
          </div>

          {/* Build X Pane */}
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">
                Build {formatInt(hubspotTarget)} by{" "}
                {targetDateText || "DD/MM/YYYY"}
              </div>
              <span className="badge badge--hot">Plan</span>
            </div>

            {/* Date inputs */}
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
                  onBlur={(e) =>
                    setStartDateText(normalizeDateInput(e.target.value))
                  }
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
                  onBlur={(e) =>
                    setTargetDateText(normalizeDateInput(e.target.value))
                  }
                  placeholder="DD/MM/YYYY"
                />
                <div className="muted">
                  {targetDate ? "✓ Valid" : "Enter e.g. 01/04/2026"}
                </div>
              </div>
            </div>

            {/* Required vs capacity */}
            <div className="twoCol" style={{ marginTop: 12 }}>
              <div className="stat">
                <div className="statKicker">Workdays remaining</div>
                <div className="statNum">
                  {formatInt(model.workdaysRemaining)}
                </div>
              </div>

              <div className="stat">
                <div className="statKicker">Names still needed</div>
                <div className="statNum">
                  {formatInt(model.namesStillNeeded)}
                </div>
              </div>

              <div className="stat">
                <div className="statKicker">Required send / workday</div>
                <div className="statNum">
                  {formatInt(model.requiredSendPerDay)}
                </div>
              </div>

              <div className="stat">
                <div className="statKicker">
                  Send capacity / workday (fixed)
                </div>
                <div className="statNum">
                  {formatInt(model.capacitySendPerDay)}
                </div>
              </div>

              <div className="stat">
                <div className="statKicker">Required kept / workday</div>
                <div className="statNum">
                  {formatInt(model.requiredKeptPerDay)}
                </div>
              </div>

              <div className="stat">
                <div className="statKicker">Base achievable kept / workday</div>
                <div className="statNum">
                  {formatInt(model.baseAchievableKeptPerDay)}
                </div>
              </div>
            </div>

            {/* Scenario multipliers */}
            <div className="card" style={{ marginTop: 14 }}>
              <div className="cardHeader">
                <div className="cardTitle">Scenario range</div>
                <span className="badge">Band</span>
              </div>

              <div className="twoCol">
                <div className="field">
                  <div className="fieldTop">
                    <span className="label">Worst</span>
                    <span className="value">
                      {Math.round(worstMult * 100)}%
                    </span>
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
                    <span className="value">
                      {Math.round(expectedMult * 100)}%
                    </span>
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

              <p className="smallNote">
                These adjust achievable kept/day up/down around your model
                (capacity × rates) to show a realistic range.
              </p>
            </div>

            {/* Scenario forecast table + assessment */}
            <div className="callout" style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>
                Scenario forecast
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 620,
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "10px 8px",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        Scenario
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: "10px 8px",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        Achievable kept/day
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: "10px 8px",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        Days to target
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: "10px 8px",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        Status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {model.scenarios.map((s) => (
                      <tr
                        key={s.key}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        <td style={{ padding: "10px 8px", fontWeight: 800 }}>
                          {s.label}
                        </td>

                        <td
                          style={{
                            padding: "10px 8px",
                            textAlign: "right",
                            fontWeight: 900,
                          }}
                        >
                          {formatInt(s.achievableKeptPerDay)}
                        </td>

                        <td
                          style={{
                            padding: "10px 8px",
                            textAlign: "right",
                            fontWeight: 900,
                          }}
                        >
                          {Number.isFinite(s.daysToTarget)
                            ? formatInt(s.daysToTarget)
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
                  Required send/day:{" "}
                  <b>{formatInt(model.requiredSendPerDay)}</b> vs capacity/day{" "}
                  <b>{formatInt(model.capacitySendPerDay)}</b>{" "}
                  <b
                    style={{
                      color:
                        model.requiredSendPerDay <= model.capacitySendPerDay
                          ? "var(--good,#7CFFB2)"
                          : "var(--warn,#FFB9A0)",
                    }}
                  >
                    {model.requiredSendPerDay <= model.capacitySendPerDay
                      ? " (OK)"
                      : " (NEEDS CAPACITY)"}
                  </b>
                </li>
                <li>
                  Required kept/day:{" "}
                  <b>{formatInt(model.requiredKeptPerDay)}</b>
                </li>
              </ul>

              <p className="smallNote" style={{ marginTop: 10 }}>
                If required send/day exceeds capacity/day, you must raise
                capacity or improve conversion (so you need less send to create
                the same kept).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
