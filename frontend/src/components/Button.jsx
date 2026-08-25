/**
 * Button - one styled button used across the app.
 *
 * Variants map to the .ll-btn-* utility classes in index.css. When `loading` is
 * set the button disables itself and swaps its leading icon for a spinner, so
 * an in-flight reservation or issue can't be double-submitted.
 */

import { forwardRef } from "react";
import { Spinner } from "./States.jsx";

const VARIANT_CLASS = {
  primary: "ll-btn-primary",
  secondary: "ll-btn-secondary",
  navy: "ll-btn-navy",
  danger: "ll-btn bg-red-600 text-white hover:bg-red-700",
  ghost: "ll-btn text-slate-600 hover:bg-slate-100",
  success: "ll-btn bg-emerald-600 text-white hover:bg-emerald-700",
};

const SIZE_CLASS = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "",
  lg: "px-4 py-2.5 text-base",
};

const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    type = "button",
    loading = false,
    disabled = false,
    icon: Icon,
    iconRight: IconRight,
    className = "",
    children,
    ...rest
  },
  ref,
) {
  const variantClass = VARIANT_CLASS[variant] || VARIANT_CLASS.primary;
  const sizeClass = SIZE_CLASS[size] || "";

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`${variantClass} ${sizeClass} ${className}`.trim()}
      {...rest}
    >
      {loading ? (
        <Spinner className="h-4 w-4" />
      ) : Icon ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}
      {children}
      {IconRight && !loading ? (
        <IconRight className="h-4 w-4" aria-hidden="true" />
      ) : null}
    </button>
  );
});

export default Button;
