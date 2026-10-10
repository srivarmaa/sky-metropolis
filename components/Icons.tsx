/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';

// Inline line icons (paths from Lucide, ISC licence) so the UI needs no icon font or extra package.
const Icon = ({ children, className = 'w-[18px] h-[18px]' }: { children: React.ReactNode; className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

type IconProps = { className?: string };

export const TopViewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" />
  </Icon>
);

export const PerspectiveIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
  </Icon>
);

export const RotateLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
  </Icon>
);

export const RotateRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
  </Icon>
);

export const WalkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
    <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
    <path d="M16 17h4" /><path d="M4 13h4" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </Icon>
);

export const ChevronUpIcon = (p: IconProps) => <Icon {...p}><path d="m18 15-6-6-6 6" /></Icon>;
export const ChevronDownIcon = (p: IconProps) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const ChevronLeftIcon = (p: IconProps) => <Icon {...p}><path d="m15 18-6-6 6-6" /></Icon>;
export const ChevronRightIcon = (p: IconProps) => <Icon {...p}><path d="m9 18 6-6-6-6" /></Icon>;

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" />
  </Icon>
);

export const FileCheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m9 15 2 2 4-4" />
  </Icon>
);
