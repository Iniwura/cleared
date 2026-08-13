import { useEffect, useState, useRef } from "react";
import { getTransaction, getTransactionStatus } from "./gl";

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

    setStatus(null);

    let cancelled = false;

    async function poll() {
      try {
        const tx = await getTransaction(txHash);
        if (!cancelled) {
          const nextStatus = getTransactionStatus(tx);
          setStatus(nextStatus);
          if (String(nextStatus || "").toUpperCase() === "FINALIZED" && intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
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
