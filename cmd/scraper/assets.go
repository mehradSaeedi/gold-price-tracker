package main

import (
	"compress/gzip"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"
)

// /\ Bundle the dashboard and chart assets so the server can run from any working directory.
//
//go:embed frontend fonts charting_library
var page embed.FS

type gzipResponseWriter struct {
	http.ResponseWriter
	writer *gzip.Writer
}

// gzip replaces the response body's writer, so Content-Length from the uncompressed
// file would be wrong. Let net/http choose chunked encoding for the compressed body.
func (w *gzipResponseWriter) WriteHeader(status int) {
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(data []byte) (int, error) {
	return w.writer.Write(data)
}

// chartAssetHandler compresses and caches the large, versioned TradingView assets.
func chartAssetHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/charting_library/") {
			next.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(r.URL.Path, "/charting_library/bundles/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		}

		// HEAD and byte-range requests need the original file representation; don't gzip them.
		if r.Method == http.MethodHead || r.Header.Get("Range") != "" || !acceptsGzip(r.Header.Get("Accept-Encoding")) {
			next.ServeHTTP(w, r)
			return
		}

		// BestSpeed keeps the large chart download compact without spending much VPS CPU.
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gz, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		defer gz.Close()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, writer: gz}, r)
	})
}

func registerAssetHandlers(mux *http.ServeMux) {

	frontend, err := fs.Sub(page, "frontend")
	if err != nil {
		log.Fatalf("open embedded frontend: %v", err)
	}

	mux.Handle("/charting_library/", chartAssetHandler(http.FileServer(http.FS(page))))
	mux.Handle("/fonts/", http.FileServer(http.FS(page)))
	mux.Handle("/", http.FileServer(http.FS(frontend)))
}

func acceptsGzip(header string) bool {
	// Browsers send a comma-separated list of supported encodings; honor gzip;q=0.
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(strings.TrimSpace(item), ";")
		if strings.TrimSpace(parts[0]) != "gzip" {
			continue
		}
		for _, option := range parts[1:] {
			name, value, ok := strings.Cut(strings.TrimSpace(option), "=")
			if ok && strings.TrimSpace(name) == "q" && strings.TrimSpace(value) == "0" {
				return false
			}
		}
		return true
	}
	return false
}
