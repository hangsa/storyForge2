import { useEffect, useState } from "react";
import api from "../api/client";

export interface Genre {
  id: string;
  label_zh: string;
  label_en: string;
  family: string;
  ui_visible?: boolean;
}

let cache: Genre[] | null = null;
let inflight: Promise<Genre[]> | null = null;

export function useGenres(uiVisibleOnly = true): Genre[] {
  const [genres, setGenres] = useState<Genre[]>(cache ?? []);
  useEffect(() => {
    if (cache) {
      setGenres(cache);
      return;
    }
    if (!inflight) {
      inflight = api.listGenres(uiVisibleOnly).then((data) => {
        cache = data;
        return data;
      });
    }
    inflight
      .then(setGenres)
      .catch(console.error)
      .finally(() => {
        inflight = null;
      });
  }, [uiVisibleOnly]);
  return genres;
}
