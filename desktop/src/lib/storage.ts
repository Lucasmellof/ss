export function storedValue(key: string) {
	return typeof window === "undefined" ? "" : (window.localStorage.getItem(key) ?? "");
}
