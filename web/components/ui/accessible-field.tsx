"use client";

import {
  cloneElement,
  useId,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";

type FieldControlProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  className?: string;
  id?: string;
  required?: boolean;
};

type AccessibleFieldProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  children: ReactElement<FieldControlProps>;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
  required?: boolean;
};

function joinTokens(...tokens: Array<string | undefined>) {
  return tokens.filter(Boolean).join(" ") || undefined;
}

export function AccessibleField({
  children,
  className,
  description,
  error,
  label,
  required = false,
  ...containerProps
}: AccessibleFieldProps) {
  const generatedId = useId();
  const controlId = children.props.id ?? `field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const hasError = Boolean(error);

  const control = cloneElement(children, {
    "aria-describedby": joinTokens(
      children.props["aria-describedby"],
      descriptionId,
      errorId,
    ),
    "aria-invalid": hasError || children.props["aria-invalid"] || undefined,
    className: joinTokens("field__control", children.props.className),
    id: controlId,
    required: required || children.props.required || undefined,
  });

  return (
    <div {...containerProps} className={joinTokens("field", className)}>
      <label className="field__label" htmlFor={controlId}>
        {label}
        {required ? (
          <span aria-hidden="true" className="field__required">
            {" "}
            (required)
          </span>
        ) : null}
      </label>
      {description ? (
        <span className="field__description" id={descriptionId}>
          {description}
        </span>
      ) : null}
      {control}
      {error ? (
        <p className="field__error" id={errorId}>
          Error: {error}
        </p>
      ) : null}
    </div>
  );
}