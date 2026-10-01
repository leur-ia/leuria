/** A `DOMException`, as the spec throws; a named `Error` where there is none. */
export function domError(name: string, message: string): Error {
	if (typeof DOMException !== "undefined") return new DOMException(message, name);
	const error = new Error(message);
	error.name = name;
	return error;
}

export function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? domError("AbortError", "The operation was aborted.");
}
