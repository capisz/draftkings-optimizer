// src/components/ui/alert.tsx
import React from "react";

export const Alert = ({ children }: { children: React.ReactNode }) => (
  <div className="border border-yellow-500 bg-yellow-100 text-yellow-800 p-4 rounded-md">
    {children}
  </div>
);

export const AlertTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="font-bold mb-1">{children}</h3>
);

export const AlertDescription = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm">{children}</p>
);
