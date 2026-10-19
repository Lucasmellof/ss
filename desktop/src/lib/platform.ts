export const desktop = typeof window !== "undefined" ? window.screenShare : undefined;
export const isDesktop = Boolean(desktop);
export const platform: DesktopPlatform | "web" = desktop?.platform ?? "web";
