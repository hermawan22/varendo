package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func fixtureSite(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for name, content := range map[string]string{
		"index.html":                            "<h1>Varendo</h1>",
		"404.html":                              "<h1>Not found</h1>",
		"playground/index.html":                 "<h1>Playground</h1>",
		"docs/index.html":                       "<h1>Docs</h1>",
		"docs/components/data.table/index.html": "<h1>Table</h1>",
		"route-map.json":                        `{"legacyDocs":{"/docs":"/","/docs/":"/","/docs/start/":"/start/","/docs/components/data.table/":"/components/data.table/"},"canonicalDocs":["/","/playground/","/components/data.table/"]}`,
		"robots-main.txt":                       "main robots",
		"robots-docs.txt":                       "docs robots",
		"sitemap-main.xml":                      "main sitemap",
		"sitemap-docs.xml":                      "docs sitemap",
		"llms-main.txt":                         "main llms",
		"llms-docs.txt":                         "docs llms",
		"assets/site-abcdefgh.js":               "console.log('aeliqo')",
		"aeliqo.png":                            "not-a-real-png",
	} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func request(t *testing.T, handler http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
	return recorder
}

func TestOperationalEndpointsEmbedRevisionAndNeverCache(t *testing.T) {
	handler := newHandler(fixtureSite(t), "source-123")
	for _, endpoint := range []struct{ path, want string }{
		{"/healthz", `"status":"ok"`},
		{"/readyz", `"status":"ready"`},
		{"/version", `"siteRevision":"source-123"`},
	} {
		response := request(t, handler, http.MethodGet, endpoint.path)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), endpoint.want) {
			t.Fatalf("%s: status=%d body=%q", endpoint.path, response.Code, response.Body.String())
		}
		if got := response.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s cache-control=%q", endpoint.path, got)
		}
	}
	version := request(t, handler, http.MethodGet, "/version")
	for _, want := range []string{`"product":"aeliqo-site"`, `"sdkRepository":"https://github.com/hermawan22/varendo"`, `"sdkRevision":"unknown"`, `"sdkVersion":"unknown"`} {
		if !strings.Contains(version.Body.String(), want) {
			t.Fatalf("version body %q does not contain %q", version.Body.String(), want)
		}
	}
}

func TestReadinessReturnsServiceUnavailableWhileDraining(t *testing.T) {
	var ready atomic.Bool
	ready.Store(true)
	handler := newHandlerWithReadiness(fixtureSite(t), "source-123", &ready)

	response := request(t, handler, http.MethodGet, "/readyz")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ready"`) {
		t.Fatalf("ready status=%d body=%q", response.Code, response.Body.String())
	}

	ready.Store(false)
	response = request(t, handler, http.MethodGet, "/readyz")
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"status":"draining"`) {
		t.Fatalf("draining status=%d body=%q", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("draining cache-control=%q", got)
	}
}

func TestGracefulTerminationBudgetFitsKubernetesGracePeriod(t *testing.T) {
	if drainDelay != 5*time.Second {
		t.Fatalf("drain delay=%s", drainDelay)
	}
	if shutdownTimeout != 20*time.Second {
		t.Fatalf("shutdown timeout=%s", shutdownTimeout)
	}
	if drainDelay+shutdownTimeout >= kubernetesGracePeriod {
		t.Fatalf("termination budget %s must leave margin inside %s", drainDelay+shutdownTimeout, kubernetesGracePeriod)
	}
	if writeTimeout < shutdownTimeout {
		t.Fatalf("write timeout %s cuts off the %s shutdown window", writeTimeout, shutdownTimeout)
	}
}

func TestServeUntilSignalMarksUnreadyBeforeDrainingActiveRequest(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	var ready atomic.Bool
	operational := newHandlerWithReadiness(fixtureSite(t), "source-123", &ready)
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/slow" {
			operational.ServeHTTP(response, request)
			return
		}
		close(requestStarted)
		<-releaseRequest
		_, _ = io.WriteString(response, "complete")
	})
	server := &http.Server{Handler: handler}
	shutdownStarted := make(chan struct{})
	server.RegisterOnShutdown(func() { close(shutdownStarted) })
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	signals := make(chan os.Signal, 1)
	done := make(chan error, 1)
	go func() {
		done <- serveUntilSignal(server, listener, &ready, signals, 100*time.Millisecond, time.Second)
	}()
	waitFor(t, time.Second, ready.Load, "server never became ready")

	responseDone := make(chan struct{})
	var responseBody string
	var responseError error
	go func() {
		defer close(responseDone)
		response, err := http.Get("http://" + listener.Addr().String() + "/slow")
		if err != nil {
			responseError = err
			return
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		responseError = err
		responseBody = string(body)
	}()

	<-requestStarted
	signals <- syscall.SIGTERM
	waitFor(t, time.Second, func() bool { return !ready.Load() }, "server stayed ready after SIGTERM")

	draining, err := http.Get("http://" + listener.Addr().String() + "/readyz")
	if err != nil {
		t.Fatal(err)
	}
	defer draining.Body.Close()
	if draining.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("draining readiness status=%d", draining.StatusCode)
	}
	select {
	case <-shutdownStarted:
		t.Fatal("shutdown started before the readiness drain delay elapsed")
	case <-time.After(50 * time.Millisecond):
	}
	select {
	case <-responseDone:
		t.Fatal("active request ended before graceful shutdown released it")
	default:
	}

	select {
	case <-shutdownStarted:
	case <-time.After(time.Second):
		t.Fatal("server shutdown did not start after the drain delay")
	}
	close(releaseRequest)
	select {
	case <-responseDone:
	case <-time.After(time.Second):
		t.Fatal("active request did not complete during graceful shutdown")
	}
	if responseError != nil {
		t.Fatal(responseError)
	}
	if responseBody != "complete" {
		t.Fatalf("active request was not drained: %q", responseBody)
	}
	if err := <-done; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("server shutdown returned %v", err)
	}
}

func TestServeUntilSignalForcesCloseAtShutdownDeadline(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseRequest
		_, _ = io.WriteString(response, "late")
	})}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var ready atomic.Bool
	signals := make(chan os.Signal, 1)
	done := make(chan error, 1)
	go func() {
		done <- serveUntilSignal(server, listener, &ready, signals, 0, 25*time.Millisecond)
	}()
	waitFor(t, time.Second, ready.Load, "server never became ready")

	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		response, err := http.Get("http://" + listener.Addr().String())
		if err == nil {
			defer response.Body.Close()
			_, _ = io.ReadAll(response.Body)
		}
	}()
	<-requestStarted
	signals <- syscall.SIGTERM

	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("shutdown deadline returned %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown deadline did not force the server closed")
	}
	close(releaseRequest)
	select {
	case <-clientDone:
	case <-time.After(time.Second):
		t.Fatal("client did not observe forced close")
	}
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool, failure string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal(failure)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestStaticRoutesApplySecurityAndCachePolicies(t *testing.T) {
	handler := newHandler(fixtureSite(t), "test")
	home := request(t, handler, http.MethodGet, "/")
	if home.Code != http.StatusOK || home.Header().Get("Cache-Control") != "no-cache, no-transform" {
		t.Fatalf("home status=%d cache=%q", home.Code, home.Header().Get("Cache-Control"))
	}
	if got := home.Header().Get("Content-Security-Policy"); got != securityPolicy {
		t.Fatalf("CSP=%q", got)
	}
	for _, source := range []string{
		"style-src 'self'; style-src-attr 'unsafe-inline'",
		"script-src 'self' https://www.googletagmanager.com",
		"connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com",
	} {
		if !strings.Contains(home.Header().Get("Content-Security-Policy"), source) {
			t.Fatalf("CSP missing %q: %q", source, home.Header().Get("Content-Security-Policy"))
		}
	}
	if got := home.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("nosniff=%q", got)
	}
	asset := request(t, handler, http.MethodGet, "/assets/site-abcdefgh.js")
	if asset.Code != http.StatusOK || asset.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset status=%d cache=%q", asset.Code, asset.Header().Get("Cache-Control"))
	}
	if !strings.HasPrefix(asset.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("asset content-type=%q", asset.Header().Get("Content-Type"))
	}
	docs := request(t, handler, http.MethodGet, "/docs")
	if docs.Code != http.StatusPermanentRedirect || docs.Header().Get("Location") != "https://hermawan22.github.io/varendo/docs/" {
		t.Fatalf("docs status=%d location=%q", docs.Code, docs.Header().Get("Location"))
	}
	docsSlash := request(t, handler, http.MethodGet, "/docs/")
	if docsSlash.Code != http.StatusPermanentRedirect || docsSlash.Header().Get("Location") != "https://hermawan22.github.io/varendo/docs/" {
		t.Fatalf("docs slash status=%d location=%q", docsSlash.Code, docsSlash.Header().Get("Location"))
	}
	legacyStart := request(t, handler, http.MethodGet, "/docs/start/")
	if legacyStart.Code != http.StatusPermanentRedirect || legacyStart.Header().Get("Location") != "https://hermawan22.github.io/varendo/start/" {
		t.Fatalf("legacy start status=%d location=%q", legacyStart.Code, legacyStart.Header().Get("Location"))
	}
	dottedRoute := request(t, handler, http.MethodGet, "/docs/components/data.table/")
	if dottedRoute.Code != http.StatusPermanentRedirect || dottedRoute.Header().Get("Location") != "https://hermawan22.github.io/varendo/components/data.table/" {
		t.Fatalf("dotted route status=%d location=%q", dottedRoute.Code, dottedRoute.Header().Get("Location"))
	}
}

func TestPlaygroundCspIsScopedToItsCanonicalDocsRoute(t *testing.T) {
	handler := newHandler(fixtureSite(t), "test")
	for _, testCase := range []struct {
		target string
		want   string
	}{
		{"https://docs.localhost/playground/", playgroundSecurityPolicy},
		{"https://docs.localhost/playground/", playgroundSecurityPolicy},
		{"http://10.0.0.1:8080/playground/", playgroundSecurityPolicy},
		{"https://docs.localhost/", securityPolicy},
		{"https://docs.localhost/components/data.table/", securityPolicy},
		{"https://varendo.localhost/playground/", playgroundSecurityPolicy},
	} {
		response := request(t, handler, http.MethodGet, testCase.target)
		if got := response.Header().Get("Content-Security-Policy"); got != testCase.want {
			t.Fatalf("%s CSP=%q, want %q", testCase.target, got, testCase.want)
		}
	}
}

func TestStaticFilesCannotEscapeThroughSymlinks(t *testing.T) {
	root := fixtureSite(t)
	secret := filepath.Join(t.TempDir(), "secret.html")
	if err := os.WriteFile(secret, []byte("outside root"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(root, "escape.html")); err != nil {
		t.Fatal(err)
	}
	response := request(t, newHandler(root, "test"), http.MethodGet, "/escape.html")
	if response.Code != http.StatusNotFound || strings.Contains(response.Body.String(), "outside root") {
		t.Fatalf("symlink escape status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestServerHasBoundedWriteTimeout(t *testing.T) {
	server := newServer(":0", fixtureSite(t), "test")
	if server.WriteTimeout != writeTimeout || server.WriteTimeout <= 0 {
		t.Fatalf("write timeout=%s", server.WriteTimeout)
	}
}

func TestUnknownAndUnsafePathsReturnStatic404(t *testing.T) {
	handler := newHandler(fixtureSite(t), "test")
	for _, target := range []string{"/not-here", "/../../etc/passwd", "/missing.png"} {
		response := request(t, handler, http.MethodGet, target)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status=%d", target, response.Code)
		}
		if response.Header().Get("Cache-Control") != "no-cache, no-transform" {
			t.Fatalf("%s cache=%q", target, response.Header().Get("Cache-Control"))
		}
		if !strings.Contains(response.Body.String(), "Not found") {
			t.Fatalf("%s body=%q", target, response.Body.String())
		}
	}
}

func TestHeadAndMethodPolicy(t *testing.T) {
	handler := newHandler(fixtureSite(t), "test")
	head := request(t, handler, http.MethodHead, "/version")
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("head status=%d body=%q", head.Code, head.Body.String())
	}
	post := request(t, handler, http.MethodPost, "/")
	if post.Code != http.StatusMethodNotAllowed || post.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("post status=%d allow=%q", post.Code, post.Header().Get("Allow"))
	}
}

func TestStaticResponseReadsFile(t *testing.T) {
	handler := newHandler(fixtureSite(t), "test")
	response := request(t, handler, http.MethodGet, "/aeliqo.png")
	body, err := io.ReadAll(response.Result().Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "not-a-real-png" {
		t.Fatalf("body=%q", body)
	}
}

func TestOnlyHashedAssetsAreImmutable(t *testing.T) {
	root := fixtureSite(t)
	for _, name := range []string{
		"site-EAgs_aNb.js",
		"site-abc-def1.js",
		"site-abcdefg.js",
		"site-abcdefghi.js",
		"site-abc!def1.js",
		"manual.js",
	} {
		if err := os.WriteFile(filepath.Join(root, "assets", name), []byte(name), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "static"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "static", "site-abcdefgh.js"), []byte("outside assets"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := newHandler(root, "test")
	for _, testCase := range []struct {
		path string
		want string
	}{
		{"/assets/site-abcdefgh.js", "public, max-age=31536000, immutable"},
		{"/assets/site-EAgs_aNb.js", "public, max-age=31536000, immutable"},
		{"/assets/site-abc-def1.js", "public, max-age=31536000, immutable"},
		{"/assets/site-abcdefg.js", "public, max-age=3600"},
		{"/assets/site-abcdefghi.js", "public, max-age=3600"},
		{"/assets/site-abc!def1.js", "public, max-age=3600"},
		{"/assets/manual.js", "public, max-age=3600"},
		{"/static/site-abcdefgh.js", "public, max-age=3600"},
		{"/assets/../index.html", "no-cache, no-transform"},
	} {
		response := request(t, handler, http.MethodGet, testCase.path)
		if got := response.Header().Get("Cache-Control"); got != testCase.want {
			t.Fatalf("%s cache-control=%q, want %q", testCase.path, got, testCase.want)
		}
	}
}

func TestDocumentationHostUsesDocsRootAndSharedStaticRoutes(t *testing.T) {
	handler := newHandler(fixtureSite(t), "docs-source")
	for _, test := range []struct{ target, want string }{
		{"https://docs.localhost/", "<h1>Docs</h1>"},
		{"https://DOCS.LOCALHOST:443/", "<h1>Docs</h1>"},
		{"http://docs.localhost/", "<h1>Docs</h1>"},
		{"https://docs.localhost/playground/", "<h1>Playground</h1>"},
		{"https://docs.localhost/components/data.table/", "<h1>Table</h1>"},
		{"https://docs.localhost/assets/site-abcdefgh.js", "console.log('aeliqo')"},
		{"https://varendo.localhost/", "<h1>Varendo</h1>"},
		{"https://www.varendo.localhost/", "<h1>Varendo</h1>"},
		{"https://varendo.localhost/robots.txt", "main robots"},
		{"https://docs.localhost/robots.txt", "docs robots"},
		{"https://varendo.localhost/sitemap.xml", "main sitemap"},
		{"https://docs.localhost/sitemap.xml", "docs sitemap"},
		{"https://varendo.localhost/llms.txt", "main llms"},
		{"https://docs.localhost/llms.txt", "docs llms"},
	} {
		response := request(t, handler, http.MethodGet, test.target)
		if response.Code != http.StatusOK || response.Body.String() != test.want {
			t.Fatalf("%s: status=%d body=%q", test.target, response.Code, response.Body.String())
		}
	}
	for _, test := range []struct{ target, location string }{
		{"https://varendo.localhost/playground/?scenario=people", "https://hermawan22.github.io/varendo/playground/?scenario=people"},
		{"https://docs.localhost/docs/components/data.table/", "https://hermawan22.github.io/varendo/components/data.table/"},
	} {
		response := request(t, handler, http.MethodGet, test.target)
		if response.Code != http.StatusPermanentRedirect || response.Header().Get("Location") != test.location {
			t.Fatalf("%s: status=%d location=%q", test.target, response.Code, response.Header().Get("Location"))
		}
	}
}
