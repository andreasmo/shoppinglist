// Schlichte Linien-Icons (24er-Raster), Farbe über currentColor.
import type { ReactNode } from "react";

function Icon({ size = 20, children, strokeWidth }: { size?: number; children: ReactNode; strokeWidth?: number }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={strokeWidth ? { strokeWidth } : undefined}>
      {children}
    </svg>
  );
}

type P = { size?: number };

const CLOUD = "M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z";

export const ChevronDown = ({ size }: P) => <Icon size={size}><path d="M6 9l6 6 6-6" /></Icon>;
export const ChevronRight = ({ size }: P) => <Icon size={size}><path d="M9 6l6 6-6 6" /></Icon>;
export const Check = ({ size = 13 }: P) => <Icon size={size} strokeWidth={3.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const Plus = ({ size }: P) => <Icon size={size}><path d="M12 5v14M5 12h14" /></Icon>;
export const PlusCircle = ({ size }: P) => <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Icon>;
export const CheckCircle = ({ size }: P) => <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></Icon>;
export const More = ({ size }: P) => (
  <Icon size={size}><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></Icon>
);
export const Close = ({ size }: P) => <Icon size={size}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const ArrowRight = ({ size }: P) => <Icon size={size}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const Eye = ({ size }: P) => (
  <Icon size={size}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>
);
export const EyeOff = ({ size }: P) => (
  <Icon size={size}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><path d="M3 3l18 18" /></Icon>
);
export const CloudOk = ({ size }: P) => <Icon size={size}><path d={CLOUD} /><path d="M9.5 13.5l2 2 3.5-3.5" /></Icon>;
export const CloudOff = ({ size }: P) => <Icon size={size}><path d={CLOUD} /><path d="M4 4l16 16" /></Icon>;
export const CloudSync = ({ size }: P) => <Icon size={size}><path d={CLOUD} /><path d="M12 10.5v5M9.8 13.3L12 15.5l2.2-2.2" /></Icon>;
export const Refresh = ({ size }: P) => <Icon size={size}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" /></Icon>;
export const UserPlus = ({ size }: P) => (
  <Icon size={size}><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" /></Icon>
);
export const Download = ({ size }: P) => <Icon size={size}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
export const Share = ({ size }: P) => <Icon size={size}><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" /></Icon>;
export const ChevronLeft = ({ size }: P) => <Icon size={size}><path d="M15 6l-6 6 6 6" /></Icon>;
export const Grip = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
  </Icon>
);
export const Settings = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
export const Cart = ({ size }: P) => (
  <Icon size={size}><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.7 12.4a1.5 1.5 0 0 0 1.5 1.1h8.6a1.5 1.5 0 0 0 1.5-1.2L21 7H6" /></Icon>
);
export const SortIcon = ({ size }: P) => <Icon size={size}><path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" /></Icon>;
export const Route = ({ size }: P) => (
  <Icon size={size}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" /></Icon>
);
export const Trash = ({ size }: P) => <Icon size={size}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>;
export const LogOut = ({ size }: P) => <Icon size={size}><path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H4" /></Icon>;
export const Import = ({ size }: P) => <Icon size={size}><path d="M12 3v12M7 10l5 5 5-5M4 15v5h16v-5" /></Icon>;
export const Copy = ({ size }: P) => <Icon size={size}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></Icon>;
