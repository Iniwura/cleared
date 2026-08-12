import { useEffect, useState, useRef } from "react";
import { getTransaction } from "./gl";

// Polls for the real intermediate status of a transaction, PENDING,
// PROPOSING, COMMITTING, REVEALING, ACCEPTED, FINALIZED, while a hash is
// active. Stops automatically once the hash is cleared by the caller.
export function useLiveTxStatus(txHash) {
  const [status, setStatus] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!txHash) {
      setStatus(null);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const tx = await getTransaction(txHash);
        if (!cancelled) {
          setStatus(tx?.status_name || tx?.status || null);
        }
      } catch (e) {
        // Transaction may not be indexed yet in the first second or two,
        // that's normal right after submission, not a real error.
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 2500);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [txHash]);

  return status;
}
