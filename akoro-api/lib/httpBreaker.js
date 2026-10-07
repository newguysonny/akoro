/**
 * lib/httpBreaker.js — an axios call family behind one circuit breaker.
 *
 * The pattern paystackBreaker.js introduced, factored out once a second
 * family (live-class providers) needed it: every outbound axios call for a
 * provider runs through a single breaker so its state is shared, visible in
 * /health.breakers, and failure turns into one honest 503 instead of each
 * caller hanging on its own timeout.
 */
import axios from "axios";
import { makeBreaker } from "./circuitBreaker.js";

export function makeHttpBreaker(name, errorClass) {
  const breaker = makeBreaker(
    name,
    // Accepts an axios config OR a zero-arg request thunk.
    (arg) => (typeof arg === "function" ? arg() : axios(arg)),
    { errorClass },
  );

  return {
    breaker,
    post:   (url, body, config = {}) => breaker.fire({ ...config, method: "post",   url, data: body }),
    get:    (url, config = {})       => breaker.fire({ ...config, method: "get",    url }),
    delete: (url, config = {})       => breaker.fire({ ...config, method: "delete", url }),
    put:    (url, body, config = {}) => breaker.fire({ ...config, method: "put",    url, data: body }),
    through: (fn)                    => breaker.fire(fn),
  };
}
