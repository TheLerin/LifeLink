/**
 * Form primitives.
 *
 * Each field accepts an `error` string so backend validation messages land next
 * to the offending input. Client-side `required` is a convenience only - the
 * Pydantic schema and the PostgreSQL constraints remain the real validators, as
 * the blueprint requires.
 */

import { formatEnum } from "../utils/format.js";

function FieldShell({ id, label, hint, error, required, className, children }) {
  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="ll-label">
          {label}
          {required ? <span className="ml-0.5 text-blood-600">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

const errorRing = "border-red-400 focus:border-red-500 focus:ring-red-500";

export function TextField({
  id,
  name,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  error,
  required = false,
  disabled = false,
  min,
  max,
  step,
  maxLength,
  autoComplete,
  className = "",
  inputClassName = "",
}) {
  const fieldId = id || name;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <input
        id={fieldId}
        name={name}
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        autoComplete={autoComplete}
        className={`ll-input ${error ? errorRing : ""} ${inputClassName}`}
      />
    </FieldShell>
  );
}

export function SelectField({
  id,
  name,
  label,
  value,
  onChange,
  options = [],
  placeholder = "Select…",
  hint,
  error,
  required = false,
  disabled = false,
  className = "",
}) {
  const fieldId = id || name;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <select
        id={fieldId}
        name={name}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        className={`ll-input ${error ? errorRing : ""}`}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => {
          const optionValue = typeof option === "object" ? option.value : option;
          const optionLabel =
            typeof option === "object" ? option.label : formatEnum(option);
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  id,
  name,
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  hint,
  error,
  required = false,
  disabled = false,
  maxLength,
  className = "",
}) {
  const fieldId = id || name;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        className={`ll-input resize-y ${error ? errorRing : ""}`}
      />
    </FieldShell>
  );
}

export function CheckboxField({
  id,
  name,
  label,
  checked,
  onChange,
  hint,
  disabled = false,
  className = "",
}) {
  const fieldId = id || name;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="flex items-start gap-2">
        <input
          id={fieldId}
          name={name}
          type="checkbox"
          checked={Boolean(checked)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blood-600 focus:ring-blood-500"
        />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
      {hint ? <p className="mt-1 pl-6 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Responsive grid wrapper so forms line up without bespoke layout per page. */
export function FormGrid({ columns = 2, children, className = "" }) {
  const cols = {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
  };
  return (
    <div className={`grid grid-cols-1 gap-4 ${cols[columns] || cols[2]} ${className}`}>
      {children}
    </div>
  );
}
