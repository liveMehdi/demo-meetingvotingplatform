import type { ComponentProps } from "react";

const paths = {
  ballot: "M7 4l3 3 6-6M5 11h14v10H5zM9 15h6",
  polls: "M5 20V10m7 10V4m7 16v-7",
  qr: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM21 14v3m-6 4h3m3-1v1",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  calendar: "M8 2v4m8-4v4M4 10h16M4 4h16v17H4z",
  check: "M5 12l4 4L19 6",
  clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
} as const;

export function Icon({
  name,
  ...props
}: ComponentProps<"svg"> & { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
