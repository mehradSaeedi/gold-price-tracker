package scraper

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newTestSnappScraper(t *testing.T, client *http.Client) (*SnappSarmayehScraper, error) {
	t.Helper()
	t.Setenv("SNAPP_ACCESS_TOKEN", "test-access-token")
	t.Setenv("SNAPP_REFRESH_TOKEN", "test-refresh-token")
	t.Setenv("SNAPP_ACCESS_TOKEN_EXPIRES_IN", "3600")
	t.Setenv("SNAPP_DEVICE_ID", "test-device-id")
	t.Setenv("SNAPP_CLIENT_ID", "test-client-id")
	t.Setenv("SNAPP_CLIENT_SECRET", "test-client-secret")
	t.Setenv("SNAPP_TOKEN_FILE", filepath.Join(t.TempDir(), "snapp-tokens.json"))
	t.Setenv("SNAPP_RAW_FINGERPRINT", "")
	return NewSnappSarmayehScraper(client)
}

func expireSnappToken(scraper *SnappSarmayehScraper) {
	scraper.tokens.tokens.RefreshAt = time.Now().Add(-time.Second)
	scraper.tokens.tokens.ExpiresAt = time.Now().Add(-time.Second)
}

func jsonResponse(status int, body string, request *http.Request) *http.Response {
	return &http.Response{
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    request,
	}
}

func TestSnappTokenRefreshRotatesAndPersistsBothTokens(t *testing.T) {
	var refreshCalls atomic.Int32
	client := &http.Client{Transport: snappRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != snappRefreshURL {
			t.Fatalf("refresh request = %s %s, want POST %s", request.Method, request.URL, snappRefreshURL)
		}
		if request.Header.Get("Content-Type") != "application/json" || request.Header.Get("Accept") != "application/json" {
			t.Fatalf("refresh headers = %#v", request.Header)
		}
		var body snappRefreshRequest
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode refresh body: %v", err)
		}
		if body.GrantType != "refresh_token" || body.ClientID != "test-client-id" || body.ClientSecret != "test-client-secret" || body.DeviceID != "test-device-id" || body.RefreshToken != "test-refresh-token" {
			t.Fatalf("refresh body did not contain expected test fields")
		}
		refreshCalls.Add(1)
		return jsonResponse(http.StatusOK, `{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","expires_in":3600}`, request), nil
	})}
	scraper, err := newTestSnappScraper(t, client)
	if err != nil {
		t.Fatal(err)
	}
	expireSnappToken(scraper)

	token, err := scraper.tokens.accessToken()
	if err != nil {
		t.Fatalf("accessToken returned error: %v", err)
	}
	if token != "rotated-access-token" {
		t.Fatalf("access token = %q, want rotated token", token)
	}
	if refreshCalls.Load() != 1 {
		t.Fatalf("refresh calls = %d, want 1", refreshCalls.Load())
	}
	data, err := os.ReadFile(os.Getenv("SNAPP_TOKEN_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	var persisted snappOAuthTokens
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.AccessToken != "rotated-access-token" || persisted.RefreshToken != "rotated-refresh-token" {
		t.Fatalf("persisted tokens were not both rotated")
	}
	info, err := os.Stat(os.Getenv("SNAPP_TOKEN_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != snappTokenFileMode {
		t.Errorf("token file mode = %04o, want %04o", info.Mode().Perm(), snappTokenFileMode)
	}
}

func TestSnappRefreshFailureKeepsExistingTokensAndDoesNotExposeSecrets(t *testing.T) {
	client := &http.Client{Transport: snappRoundTripper(func(request *http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusServiceUnavailable, `{"error":"test-client-secret test-refresh-token"}`, request), nil
	})}
	scraper, err := newTestSnappScraper(t, client)
	if err != nil {
		t.Fatal(err)
	}
	expireSnappToken(scraper)
	token, err := scraper.tokens.accessToken()
	if err == nil {
		t.Fatal("accessToken succeeded after refresh failure")
	}
	if token != "" {
		t.Fatalf("accessToken returned token after refresh failure")
	}
	for _, secret := range []string{"test-access-token", "test-refresh-token", "test-client-secret"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("refresh error exposed a secret")
		}
	}
	if scraper.tokens.tokens.AccessToken != "test-access-token" || scraper.tokens.tokens.RefreshToken != "test-refresh-token" {
		t.Fatal("failed refresh changed the active tokens")
	}
}

func TestSnappExpiredAccessTokenRefreshesBeforePriceRequest(t *testing.T) {
	var priceCalls atomic.Int32
	client := &http.Client{Transport: snappRoundTripper(func(request *http.Request) (*http.Response, error) {
		switch request.URL.String() {
		case snappRefreshURL:
			return jsonResponse(http.StatusOK, `{"access_token":"fresh-access-token","refresh_token":"fresh-refresh-token","expires_in":3600}`, request), nil
		case snappSarmayehPriceURL:
			priceCalls.Add(1)
			if request.Header.Get("Authorization") != "Bearer fresh-access-token" {
				t.Errorf("price request did not use the refreshed access token")
			}
			return jsonResponse(http.StatusOK, snappResponseFixture, request), nil
		default:
			t.Fatalf("unexpected URL %s", request.URL)
			return nil, nil
		}
	})}
	scraper, err := newTestSnappScraper(t, client)
	if err != nil {
		t.Fatal(err)
	}
	expireSnappToken(scraper)
	if _, err := scraper.GetPrice(); err != nil {
		t.Fatalf("GetPrice returned error: %v", err)
	}
	if priceCalls.Load() != 1 {
		t.Fatalf("price requests = %d, want 1", priceCalls.Load())
	}
}

func TestSnappUnauthorizedRequestRefreshesAndRetriesOnce(t *testing.T) {
	var priceCalls atomic.Int32
	var refreshCalls atomic.Int32
	client := &http.Client{Transport: snappRoundTripper(func(request *http.Request) (*http.Response, error) {
		switch request.URL.String() {
		case snappSarmayehPriceURL:
			if priceCalls.Add(1) == 1 {
				return jsonResponse(http.StatusUnauthorized, `{}`, request), nil
			}
			if request.Header.Get("Authorization") != "Bearer retried-access-token" {
				t.Errorf("retry did not use refreshed access token")
			}
			return jsonResponse(http.StatusOK, snappResponseFixture, request), nil
		case snappRefreshURL:
			refreshCalls.Add(1)
			return jsonResponse(http.StatusOK, `{"access_token":"retried-access-token","refresh_token":"retried-refresh-token","expires_in":3600}`, request), nil
		default:
			t.Fatalf("unexpected URL %s", request.URL)
			return nil, nil
		}
	})}
	scraper, err := newTestSnappScraper(t, client)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scraper.GetPrice(); err != nil {
		t.Fatalf("GetPrice returned error: %v", err)
	}
	if priceCalls.Load() != 2 || refreshCalls.Load() != 1 {
		t.Fatalf("price calls=%d, refresh calls=%d; want 2 and 1", priceCalls.Load(), refreshCalls.Load())
	}
}

func TestSnappConcurrentExpiredRequestsShareOneRefresh(t *testing.T) {
	const callers = 20
	refreshStarted := make(chan struct{})
	releaseRefresh := make(chan struct{})
	var refreshCalls atomic.Int32
	var startOnce sync.Once
	client := &http.Client{Transport: snappRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != snappRefreshURL {
			t.Fatalf("unexpected URL %s", request.URL)
		}
		if refreshCalls.Add(1) == 1 {
			startOnce.Do(func() { close(refreshStarted) })
		}
		<-releaseRefresh
		return jsonResponse(http.StatusOK, `{"access_token":"shared-access-token","refresh_token":"shared-refresh-token","expires_in":3600}`, request), nil
	})}
	scraper, err := newTestSnappScraper(t, client)
	if err != nil {
		t.Fatal(err)
	}
	expireSnappToken(scraper)

	results := make(chan error, callers)
	for i := 0; i < callers; i++ {
		go func() {
			token, err := scraper.tokens.accessToken()
			if err == nil && token != "shared-access-token" {
				err = fmt.Errorf("got an unexpected token")
			}
			results <- err
		}()
	}
	<-refreshStarted
	close(releaseRefresh)
	for i := 0; i < callers; i++ {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if got := refreshCalls.Load(); got != 1 {
		t.Fatalf("refresh calls = %d, want 1", got)
	}
}

func TestNewSnappScraperLoadsPersistedTokensWithoutTokenEnvironment(t *testing.T) {
	client := &http.Client{Transport: snappRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Fatalf("unexpected HTTP request during construction")
		return nil, nil
	})}
	scraper, err := newTestSnappScraper(t, client)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("SNAPP_ACCESS_TOKEN", "")
	t.Setenv("SNAPP_REFRESH_TOKEN", "")
	t.Setenv("SNAPP_ACCESS_TOKEN_EXPIRES_IN", "")
	loaded, err := NewSnappSarmayehScraper(client)
	if err != nil {
		t.Fatalf("load persisted tokens: %v", err)
	}
	if loaded.tokens.tokens.AccessToken != scraper.tokens.tokens.AccessToken || loaded.tokens.tokens.RefreshToken != scraper.tokens.tokens.RefreshToken {
		t.Fatal("persisted tokens were not loaded")
	}
}

func TestSnappTokenFileRejectsSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.json")
	if err := os.WriteFile(target, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directory, "tokens.json")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	config := snappOAuthConfig{tokenFile: link}
	if _, err := loadOrInitializeSnappTokens(config); err == nil {
		t.Fatal("expected symlink token path to be rejected")
	}
}
