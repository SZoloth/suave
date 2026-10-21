import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; className?: string };

export const Pressable = forwardRef<HTMLButtonElement, Props>(function Pressable({ children, className = "", type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={`pressable ${className}`} {...rest}>
      {children}
    </button>
  );
});
