import { useState } from "react";
import { formatILS } from "./format";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
  details?: DonutSliceDetail[];
}

export interface DonutSliceDetail {
  key: string;
  label: string;
  value: number;
  meta: string;
  children?: DonutSliceDetail[];
  categoryOptions?: string[];
  categoryValue?: string;
  oneTime?: boolean;
  oneTimeAuto?: boolean;
  fixedOverride?: boolean;
}

export interface CategoryChoice {
  value: string;
  label: string;
}

interface Props {
  slices: DonutSlice[];
  title: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  expandedKey?: string | null;
  onExpand?: (key: string | null) => void;
  excludedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
  detailCategoryValues?: Record<string, string>;
  categoryOptions?: CategoryChoice[];
  onCategorizeDetail?: (detailKey: string, category: string) => void;
  onToggleOneTimeDetail?: (detailKey: string) => void;
  onToggleFixedDetail?: (detailKey: string) => void;
}

const CX = 110;
const CY = 110;
const R_OUTER = 100;
const R_INNER = 64;

function polar(r: number, angle: number): [number, number] {
  return [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];
}

function arcPath(a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(R_OUTER, a0);
  const [x1, y1] = polar(R_OUTER, a1);
  const [x2, y2] = polar(R_INNER, a1);
  const [x3, y3] = polar(R_INNER, a0);
  return `M${x0} ${y0} A${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${R_INNER} ${R_INNER} 0 ${large} 0 ${x3} ${y3} Z`;
}

/**
 * Donut chart with a clickable legend list (click filters the detail table).
 * Slice separation is a 2px surface-colored stroke; identity is carried by
 * the legend labels + values, never by color alone.
 */
export function Donut({
  slices,
  title,
  selectedKey,
  onSelect,
  expandedKey,
  onExpand,
  excludedKeys,
  onToggleKey,
  detailCategoryValues,
  categoryOptions,
  onCategorizeDetail,
  onToggleOneTimeDetail,
  onToggleFixedDetail,
}: Props) {
  const rawTotal = slices.reduce((sum, s) => sum + s.value, 0);
  const activeSlices = slices.filter((s) => !excludedKeys?.has(s.key));
  const total = activeSlices.reduce((sum, s) => sum + s.value, 0);

  if (rawTotal === 0) {
    return (
      <div className="donut-card">
        <h3>{title}</h3>
        <p className="donut-empty">אין תנועות בתקופה זו</p>
      </div>
    );
  }

  let angle = -Math.PI / 2;
  const arcs = activeSlices.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    // cap just below a full circle — a single-slice arc collapses otherwise
    const a0 = angle;
    const a1 = angle + Math.min(sweep, Math.PI * 2 - 0.0001);
    angle += sweep;
    return { ...s, a0, a1 };
  });

  return (
    <div className="donut-card">
      <h3>{title}</h3>
      <div className="donut-layout">
        <svg viewBox="0 0 220 220" className="donut-svg" role="img" aria-label={title}>
          {arcs.map((a) => (
            <path
              key={a.key}
              d={arcPath(a.a0, a.a1)}
              fill={a.color}
              className={`donut-slice ${selectedKey && selectedKey !== a.key ? "dimmed" : ""}`}
              onClick={() => onSelect(selectedKey === a.key ? null : a.key)}
            >
              <title>{`${a.label}: ${formatILS(a.value)} (${Math.round((a.value / total) * 100)}%)`}</title>
            </path>
          ))}
          <text x={CX} y={CY - 4} textAnchor="middle" className="donut-total">
            {formatILS(total)}
          </text>
          <text x={CX} y={CY + 16} textAnchor="middle" className="donut-total-label">
            סה״כ
          </text>
        </svg>
        <ul className="donut-legend">
          {slices.map((s) => {
            const hasDetails = Boolean(s.details?.length);
            const isExpanded = expandedKey === s.key;
            const detailCategoryOptions = categoryOptions ?? [];
            return (
              <li
                key={s.key}
                className={`legend-row ${selectedKey === s.key ? "selected" : ""} ${
                  excludedKeys?.has(s.key) ? "excluded" : ""
                } ${isExpanded ? "expanded" : ""}`}
              >
                <div className="legend-main-row">
                  {onToggleKey && (
                    <button
                      type="button"
                      className="legend-power"
                      onClick={() => onToggleKey(s.key)}
                      title={excludedKeys?.has(s.key) ? `החזרת ${s.label} לחישוב` : `הוצאת ${s.label} מהחישוב`}
                      aria-label={excludedKeys?.has(s.key) ? `החזרת ${s.label} לחישוב` : `הוצאת ${s.label} מהחישוב`}
                      aria-pressed={!excludedKeys?.has(s.key)}
                    >
                      ⏻
                    </button>
                  )}
                  <button
                    type="button"
                    className="legend-select"
                    onClick={() => (hasDetails && onExpand ? onExpand(isExpanded ? null : s.key) : onSelect(selectedKey === s.key ? null : s.key))}
                    aria-expanded={hasDetails ? isExpanded : undefined}
                  >
                    <span className="swatch" style={{ background: s.color }} aria-hidden />
                    <span className="legend-label">{s.label}</span>
                    <span className="legend-value">{formatILS(s.value)}</span>
                    <span className="legend-pct">
                      {excludedKeys?.has(s.key) || total === 0 ? "כבוי" : `${Math.round((s.value / total) * 100)}%`}
                    </span>
                  </button>
                </div>
                {isExpanded && s.details && (
                  <ul className="legend-sublist">
                    {s.details.map((d) => (
                      <li key={d.key} className="legend-subrow">
                        {d.children?.length ? (
                          <details className="legend-nested">
                            <summary>
                              <span className="legend-sublabel">{d.label}</span>
                              <span className="legend-subvalue">{formatILS(d.value)}</span>
                              <span className="legend-submeta">{d.meta}</span>
                            </summary>
                            <ul className="legend-nested-list">
                              {d.children.map((child) => (
                                <li key={child.key} className="legend-subrow nested">
                                  <span className="legend-sublabel">{child.label}</span>
                                  <span className="legend-subvalue">{formatILS(child.value)}</span>
                                  <span className="legend-submeta">{child.meta}</span>
                                  <DetailActions
                                    detail={child}
                                    options={detailCategoryOptions}
                                    value={detailCategoryValues?.[child.key] ?? child.categoryValue ?? ""}
                                    onCategorize={onCategorizeDetail}
                                    onToggleOneTime={onToggleOneTimeDetail}
                                    onToggleFixed={onToggleFixedDetail}
                                  />
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : (
                          <>
                            <span className="legend-sublabel">{d.label}</span>
                            <span className="legend-subvalue">{formatILS(d.value)}</span>
                            <span className="legend-submeta">{d.meta}</span>
                            {d.key !== "__other" && !d.key.startsWith("section:") && (
                              <DetailActions
                                detail={d}
                                options={detailCategoryOptions}
                                value={detailCategoryValues?.[d.key] ?? d.categoryValue ?? ""}
                                onCategorize={onCategorizeDetail}
                                onToggleOneTime={onToggleOneTimeDetail}
                                onToggleFixed={onToggleFixedDetail}
                              />
                            )}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function DetailActions({
  detail,
  options,
  value,
  onCategorize,
  onToggleOneTime,
  onToggleFixed,
}: {
  detail: DonutSliceDetail;
  options: CategoryChoice[];
  value: string;
  onCategorize?: (detailKey: string, category: string) => void;
  onToggleOneTime?: (detailKey: string) => void;
  onToggleFixed?: (detailKey: string) => void;
}) {
  if (!onCategorize && !onToggleOneTime && !onToggleFixed) return null;

  return (
    <div className="legend-detail-actions">
      {(onToggleOneTime || onToggleFixed) ? (
        <button
          type="button"
          className={`legend-state-action ${detail.oneTime ? "active" : ""}`}
          onClick={() =>
            detail.oneTime ? onToggleFixed?.(detail.key) : onToggleOneTime?.(detail.key)
          }
          aria-pressed={detail.oneTime}
          title={detail.oneTime ? "לחיצה תסמן כסעיף קבוע" : "לחיצה תסמן כהוצאה חד פעמית"}
        >
          חד פעמי
        </button>
      ) : null}
      {detail.oneTime && !detail.oneTimeAuto && !onToggleOneTime && (
        <span className="legend-onetime-tag">חד פעמי</span>
      )}
      {onCategorize && (
        <CategoryEditor detail={detail} options={options} value={value} onCategorize={onCategorize} />
      )}
    </div>
  );
}

function CategoryEditor({
  detail,
  options,
  value,
  onCategorize,
}: {
  detail: DonutSliceDetail;
  options: CategoryChoice[];
  value: string;
  onCategorize: (detailKey: string, category: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div className="legend-category-editor">
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === "__new") {
            setIsCreating(true);
            return;
          }
          setIsCreating(false);
          onCategorize(detail.key, e.target.value);
        }}
        aria-label={`סיווג ${detail.label}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value="">ניקוי סיווג ידני</option>
        <option value="__new">קטגוריה חדשה...</option>
      </select>
      {isCreating && (
        <input
          type="text"
          placeholder="שם קטגוריה"
          autoFocus
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const value = e.currentTarget.value.trim();
            if (!value) return;
            onCategorize(detail.key, value);
            e.currentTarget.value = "";
            setIsCreating(false);
          }}
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (value) onCategorize(detail.key, value);
            e.currentTarget.value = "";
            setIsCreating(false);
          }}
        />
      )}
    </div>
  );
}
