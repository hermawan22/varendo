// Varendo's public site is a static artifact.  This small server deliberately
// provides only static delivery and operational endpoints; application data,
// authentication, and agent execution remain outside this image.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

var revision = "unknown"
var sdkRevision = "unknown"
var sdkVersion = "unknown"

const (
	staticRoot            = "/srv/aeliqo"
	rollupHashLength      = 8
	drainDelay            = 5 * time.Second
	shutdownTimeout       = 20 * time.Second
	kubernetesGracePeriod = 30 * time.Second
	writeTimeout          = 30 * time.Second
	// Varendo components use bounded Lit style attributes for responsive layout
	// and data marks. Permit attributes without permitting inline style blocks
	// or scripts. HTML responses use no-transform to opt out of intermediary
	// rewriting; the CSP still blocks undeclared scripts if that is ignored.
	securityPolicy           = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com"
	playgroundSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; font-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'"
)

func main() {
	var ready atomic.Bool
	server := newServerWithReadiness(env("AELIQO_LISTEN_ADDR", ":8080"), env("AELIQO_STATIC_ROOT", staticRoot), revision, &ready)
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		log.Fatal(err)
	}

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(shutdownSignal)

	log.Printf("Varendo static server listening on %s", server.Addr)
	if err := serveUntilSignal(server, listener, &ready, shutdownSignal, drainDelay, shutdownTimeout); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func newServer(address, root, buildRevision string) *http.Server {
	var ready atomic.Bool
	ready.Store(true)
	return newServerWithReadiness(address, root, buildRevision, &ready)
}

func newServerWithReadiness(address, root, buildRevision string, ready *atomic.Bool) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           newHandlerWithReadiness(root, buildRevision, ready),
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       60 * time.Second,
	}
}

func serveUntilSignal(server *http.Server, listener net.Listener, ready *atomic.Bool, signals <-chan os.Signal, drainFor, shutdownAfter time.Duration) error {
	serveError := make(chan error, 1)
	ready.Store(true)
	go func() {
		serveError <- server.Serve(listener)
	}()

	select {
	case err := <-serveError:
		ready.Store(false)
		return err
	case <-signals:
		// Stop receiving new traffic before waiting for load balancers and
		// kube-proxy to observe the failed readiness probe.
		ready.Store(false)
	}

	if drainFor > 0 {
		timer := time.NewTimer(drainFor)
		select {
		case err := <-serveError:
			if !timer.Stop() {
				<-timer.C
			}
			return err
		case <-timer.C:
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), shutdownAfter)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		// Shutdown does not force-close active connections when its context
		// expires. Close them so the process still exits inside the pod's
		// termination grace period.
		_ = server.Close()
		return err
	}
	return <-serveError
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func newHandler(root, buildRevision string) http.Handler {
	var ready atomic.Bool
	ready.Store(true)
	return newHandlerWithReadiness(root, buildRevision, &ready)
}

type publicRoutes struct {
	legacyDocs    map[string]string
	canonicalDocs map[string]bool
}

func newHandlerWithReadiness(root, buildRevision string, ready *atomic.Bool) http.Handler {
	routes := loadPublicRoutes(root)
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		setSecurityHeaders(response, request)
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			response.Header().Set("Allow", "GET, HEAD")
			response.Header().Set("Cache-Control", "no-store")
			http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		switch request.URL.Path {
		case "/healthz":
			writeJSON(response, request, http.StatusOK, map[string]string{"status": "ok"})
			return
		case "/readyz":
			if !ready.Load() {
				writeJSON(response, request, http.StatusServiceUnavailable, map[string]string{"status": "draining"})
				return
			}
			writeJSON(response, request, http.StatusOK, map[string]string{"status": "ready"})
			return
		case "/version":
			writeJSON(response, request, http.StatusOK, map[string]string{
				"product":       "aeliqo-site",
				"siteRevision":  buildRevision,
				"sdkRepository": "https://github.com/hermawan22/varendo",
				"sdkRevision":   sdkRevision,
				"sdkVersion":    sdkVersion,
			})
			return
		}

		requestPath := request.URL.Path
		host := request.Host
		if name, _, err := net.SplitHostPort(host); err == nil {
			host = name
		}
		isDocsHost := strings.EqualFold(host, "docs.localhost")
		if files, perHost := hostCrawlerFiles[requestPath]; perHost {
			if isDocsHost {
				requestPath = files.docs
			} else {
				requestPath = files.main
			}
		}
		if canonical, legacy := routes.legacyDocs[requestPath]; legacy {
			if canonical == "/" {
				canonical = "/docs/"
			}
			redirect(response, request, "https://hermawan22.github.io/varendo"+canonical)
			return
		}
		if routes.canonicalDocs[requestPath+"/"] {
			redirect(response, request, "https://hermawan22.github.io/varendo"+requestPath+"/")
			return
		}
		if isDocsHost {
			if requestPath != "/playground/" && !isSharedAsset(requestPath) {
				requestPath = "/docs" + requestPath
			}
		} else if requestPath != "/" && routes.canonicalDocs[requestPath] {
			redirect(response, request, "https://hermawan22.github.io/varendo"+requestPath)
			return
		}
		file, found := staticFile(root, requestPath)
		if !found {
			serveNotFound(response, request, root)
			return
		}
		serveStatic(response, request, file)
	})
}

func loadPublicRoutes(root string) publicRoutes {
	empty := publicRoutes{legacyDocs: map[string]string{}, canonicalDocs: map[string]bool{}}
	file, safe := insideRoot(root, "route-map.json")
	if !safe {
		return empty
	}
	content, err := os.ReadFile(file)
	if err != nil {
		return empty
	}
	var routes struct {
		LegacyDocs    map[string]string `json:"legacyDocs"`
		CanonicalDocs []string          `json:"canonicalDocs"`
	}
	if json.Unmarshal(content, &routes) != nil || routes.LegacyDocs == nil {
		return empty
	}
	canonical := map[string]bool{}
	for _, route := range routes.CanonicalDocs {
		if strings.HasPrefix(route, "/") {
			canonical[route] = true
		}
	}
	return publicRoutes{legacyDocs: routes.LegacyDocs, canonicalDocs: canonical}
}

// Crawler files share one public path but differ per host.
var hostCrawlerFiles = map[string]struct{ main, docs string }{
	"/robots.txt":  {main: "/robots-main.txt", docs: "/robots-docs.txt"},
	"/sitemap.xml": {main: "/sitemap-main.xml", docs: "/sitemap-docs.xml"},
	"/llms.txt":    {main: "/llms-main.txt", docs: "/llms-docs.txt"},
}

func isSharedAsset(requestPath string) bool {
	return requestPath == "/aeliqo.png" || requestPath == "/search-index.json" || requestPath == "/route-map.json" ||
		strings.HasPrefix(requestPath, "/assets/") || path.Ext(requestPath) != ""
}

func redirect(response http.ResponseWriter, request *http.Request, target string) {
	if request.URL.RawQuery != "" {
		target += "?" + request.URL.RawQuery
	}
	response.Header().Set("Cache-Control", "public, max-age=300")
	http.Redirect(response, request, target, http.StatusPermanentRedirect)
}

func setSecurityHeaders(response http.ResponseWriter, request *http.Request) {
	header := response.Header()
	policy := securityPolicy
	if isHostedPlayground(request) {
		policy = playgroundSecurityPolicy
	}
	header.Set("Content-Security-Policy", policy)
	header.Set("Cross-Origin-Opener-Policy", "same-origin")
	header.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	header.Set("X-Content-Type-Options", "nosniff")
}

func isHostedPlayground(request *http.Request) bool {
	return request.URL.Path == "/playground/"
}

func writeJSON(response http.ResponseWriter, request *http.Request, status int, value any) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	if request.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(response).Encode(value)
}

func staticFile(root, requestPath string) (string, bool) {
	clean := path.Clean("/" + requestPath)
	relative := strings.TrimPrefix(clean, "/")
	if relative == "" {
		relative = "index.html"
	}
	file, safe := insideRoot(root, relative)
	if !safe {
		return "", false
	}
	info, err := os.Stat(file)
	if err == nil && !info.IsDir() {
		return file, true
	}
	// A generated route may contain dots in a directory segment (for example
	// /docs/components/data.table/). Only treat an extension as a file request
	// when the resolved path is not an existing directory.
	if err != nil && path.Ext(relative) != "" {
		return "", false
	}
	index, safe := insideRoot(root, filepath.Join(relative, "index.html"))
	if !safe {
		return "", false
	}
	info, err = os.Stat(index)
	return index, err == nil && !info.IsDir()
}

func insideRoot(root, relative string) (string, bool) {
	base, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", false
	}
	base, err = filepath.Abs(base)
	if err != nil {
		return "", false
	}
	file, err := filepath.EvalSymlinks(filepath.Join(base, relative))
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(base, file)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return file, true
}

func serveNotFound(response http.ResponseWriter, request *http.Request, root string) {
	response.Header().Set("Cache-Control", "no-cache, no-transform")
	page, safe := insideRoot(root, "404.html")
	if safe {
		if info, err := os.Stat(page); err == nil && !info.IsDir() {
			serveStaticStatus(response, request, page, http.StatusNotFound)
			return
		}
	}
	http.Error(response, "not found", http.StatusNotFound)
}

func serveStatic(response http.ResponseWriter, request *http.Request, file string) {
	serveStaticStatus(response, request, file, http.StatusOK)
}

func serveStaticStatus(response http.ResponseWriter, request *http.Request, file string, status int) {
	content, err := os.Open(file)
	if err != nil {
		http.Error(response, "not found", http.StatusNotFound)
		return
	}
	defer content.Close()
	info, err := content.Stat()
	if err != nil || info.IsDir() {
		http.Error(response, "not found", http.StatusNotFound)
		return
	}

	if contentType := mime.TypeByExtension(filepath.Ext(file)); contentType != "" {
		response.Header().Set("Content-Type", contentType)
	}
	response.Header().Set("Cache-Control", cacheControl(request.URL.Path, file))
	response.WriteHeader(status)
	if request.Method == http.MethodHead {
		return
	}
	if _, err := io.Copy(response, content); err != nil && !errors.Is(err, os.ErrClosed) {
		log.Printf("static response copy failed: %v", err)
	}
}

func cacheControl(requestPath, file string) string {
	if isHashedAsset(path.Clean("/"+requestPath), file) {
		return "public, max-age=31536000, immutable"
	}
	if filepath.Ext(file) == ".html" {
		return "no-cache, no-transform"
	}
	return "public, max-age=3600"
}

func isHashedAsset(requestPath, file string) bool {
	if !strings.HasPrefix(requestPath, "/assets/") {
		return false
	}
	name := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	separator := len(name) - rollupHashLength - 1
	if separator <= 0 || name[separator] != '-' {
		return false
	}
	for _, character := range name[separator+1:] {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character == '_' || character == '-') {
			return false
		}
	}
	return true
}
