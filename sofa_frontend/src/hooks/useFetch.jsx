import { useState, useEffect } from "react";
import axios from "axios";
import { API_URL } from "../config.js";

const useFetch = (url) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) return;

    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      try {
        const response = await axios.get(`${API_URL}${url}`, { signal: controller.signal });
        setData(response.data);
      } catch (err) {
        if (err.code !== "ERR_CANCELED") {
          setError(err);
          console.error("Error al obtener los datos:", err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    return () => controller.abort();
  }, [url]);

  return { data, loading, error };
};

export default useFetch;
