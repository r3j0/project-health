"use client";
import { useCallback, useEffect, useRef } from "react";
import { getSession } from "@/lib/session";

/** A continuation belongs to one visible component, session, and operation. */
export function useOperationScope() {
  const version = useRef(0);
  useEffect(() => {
    return () => {
      version.current += 1;
    };
  }, []);
  return useCallback(() => {
    const operation = ++version.current;
    const generation = getSession().generation;
    return () =>
      operation === version.current && generation === getSession().generation;
  }, []);
}
