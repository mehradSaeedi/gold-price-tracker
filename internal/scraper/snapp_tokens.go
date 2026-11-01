package scraper

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	snappRefreshURL      = "https://app.snapp.taxi/api/api-passenger-oauth/v2/auth"
	snappTokenFileMode   = 0o600
	snappTokenReadLimit  = 1 << 20
	snappRefreshTimeout  = 15 * time.Second
	snappRefreshLeadTime = time.Minute
	maxTokenLifetimeSecs = int64((1<<63 - 1) / int64(time.Second))
)

type snappOAuthConfig struct {
	clientID     string
	clientSecret string
	deviceID     string
	tokenFile    string
	fingerprint  string
}

type snappOAuthTokens struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	RefreshAt    time.Time `json:"refresh_at"`
}

type snappTokenManager struct {
	mu     sync.Mutex
	client *http.Client
	config snappOAuthConfig
	tokens snappOAuthTokens
	dirty  bool
}

type snappRefreshRequest struct {
	GrantType    string `json:"grant_type"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	DeviceID     string `json:"device_id"`
	RefreshToken string `json:"refresh_token"`
}

type snappRefreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

// NewSnappSarmayehScraper loads token state from a private file, bootstrapping
// that file from environment variables on first run.
func NewSnappSarmayehScraper(client *http.Client) (*SnappSarmayehScraper, error) {
	config, err := snappOAuthConfigFromEnv()
	if err != nil {
		return nil, err
	}
	if client == nil {
		client = &http.Client{Timeout: snappRefreshTimeout}
	}
	tokens, err := loadOrInitializeSnappTokens(config)
	if err != nil {
		return nil, err
	}
	manager := &snappTokenManager{client: client, config: config, tokens: tokens}
	return &SnappSarmayehScraper{
		Client:      client,
		tokens:      manager,
		fingerprint: config.fingerprint,
	}, nil
}

func snappOAuthConfigFromEnv() (snappOAuthConfig, error) {
	config := snappOAuthConfig{
		clientID:     strings.TrimSpace(os.Getenv("SNAPP_CLIENT_ID")),
		clientSecret: strings.TrimSpace(os.Getenv("SNAPP_CLIENT_SECRET")),
		deviceID:     strings.TrimSpace(os.Getenv("SNAPP_DEVICE_ID")),
		tokenFile:    strings.TrimSpace(os.Getenv("SNAPP_TOKEN_FILE")),
		fingerprint:  strings.TrimSpace(os.Getenv("SNAPP_RAW_FINGERPRINT")),
	}
	var missing []string
	if config.clientID == "" {
		missing = append(missing, "SNAPP_CLIENT_ID")
	}
	if config.clientSecret == "" {
		missing = append(missing, "SNAPP_CLIENT_SECRET")
	}
	if config.deviceID == "" {
		missing = append(missing, "SNAPP_DEVICE_ID")
	}
	if config.tokenFile == "" {
		missing = append(missing, "SNAPP_TOKEN_FILE")
	}
	if len(missing) != 0 {
		return snappOAuthConfig{}, fmt.Errorf("Snapp Sarmayeh requires environment variables: %s", strings.Join(missing, ", "))
	}
	return config, nil
}

func loadOrInitializeSnappTokens(config snappOAuthConfig) (snappOAuthTokens, error) {
	if err := os.MkdirAll(filepath.Dir(config.tokenFile), 0o700); err != nil {
		return snappOAuthTokens{}, fmt.Errorf("prepare Snapp token directory: %w", err)
	}
	info, err := os.Lstat(config.tokenFile)
	if err == nil {
		if !info.Mode().IsRegular() {
			return snappOAuthTokens{}, errors.New("SNAPP_TOKEN_FILE must be a regular file")
		}
		if err := os.Chmod(config.tokenFile, snappTokenFileMode); err != nil {
			return snappOAuthTokens{}, fmt.Errorf("secure Snapp token file permissions: %w", err)
		}
		file, err := os.Open(config.tokenFile)
		if err != nil {
			return snappOAuthTokens{}, fmt.Errorf("open Snapp token file: %w", err)
		}
		defer file.Close()
		var tokens snappOAuthTokens
		if err := decodeSnappTokenJSON(file, &tokens); err != nil {
			return snappOAuthTokens{}, fmt.Errorf("decode Snapp token file: %w", err)
		}
		if err := validateSnappTokens(tokens); err != nil {
			return snappOAuthTokens{}, err
		}
		return tokens, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return snappOAuthTokens{}, fmt.Errorf("inspect Snapp token file: %w", err)
	}

	accessToken := strings.TrimSpace(os.Getenv("SNAPP_ACCESS_TOKEN"))
	refreshToken := strings.TrimSpace(os.Getenv("SNAPP_REFRESH_TOKEN"))
	expiresInRaw := strings.TrimSpace(os.Getenv("SNAPP_ACCESS_TOKEN_EXPIRES_IN"))
	if accessToken == "" || refreshToken == "" || expiresInRaw == "" {
		return snappOAuthTokens{}, errors.New("first Snapp token setup requires SNAPP_ACCESS_TOKEN, SNAPP_REFRESH_TOKEN, and SNAPP_ACCESS_TOKEN_EXPIRES_IN")
	}
	expiresIn, err := strconv.ParseInt(expiresInRaw, 10, 64)
	if err != nil || expiresIn <= 0 || expiresIn > maxTokenLifetimeSecs {
		return snappOAuthTokens{}, errors.New("SNAPP_ACCESS_TOKEN_EXPIRES_IN must be a positive number of seconds")
	}
	tokens := newSnappOAuthTokens(accessToken, refreshToken, time.Duration(expiresIn)*time.Second, time.Now())
	if err := persistSnappTokens(config.tokenFile, tokens); err != nil {
		return snappOAuthTokens{}, fmt.Errorf("persist initial Snapp tokens: %w", err)
	}
	return tokens, nil
}

func decodeSnappTokenJSON(reader io.Reader, target any) error {
	data, err := io.ReadAll(io.LimitReader(reader, snappTokenReadLimit+1))
	if err != nil {
		return err
	}
	if len(data) > snappTokenReadLimit {
		return errors.New("Snapp token data exceeds size limit")
	}
	return json.Unmarshal(data, target)
}

func validateSnappTokens(tokens snappOAuthTokens) error {
	if strings.TrimSpace(tokens.AccessToken) == "" || strings.TrimSpace(tokens.RefreshToken) == "" {
		return errors.New("Snapp token file is missing an access or refresh token")
	}
	if tokens.ExpiresAt.IsZero() || tokens.RefreshAt.IsZero() || tokens.RefreshAt.After(tokens.ExpiresAt) {
		return errors.New("Snapp token file has invalid expiry metadata")
	}
	return nil
}

func newSnappOAuthTokens(accessToken, refreshToken string, expiresIn time.Duration, now time.Time) snappOAuthTokens {
	if expiresIn <= 0 || expiresIn > time.Duration(maxTokenLifetimeSecs)*time.Second {
		return snappOAuthTokens{}
	}
	lead := snappRefreshLeadTime
	if tenth := expiresIn / 10; tenth < lead {
		lead = tenth
	}
	if lead <= 0 {
		lead = time.Second
	}
	expiresAt := now.Add(expiresIn)
	return snappOAuthTokens{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
		RefreshAt:    expiresAt.Add(-lead),
	}
}

func persistSnappTokens(path string, tokens snappOAuthTokens) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".snapp-tokens-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(snappTokenFileMode); err != nil {
		temporary.Close()
		return err
	}
	if err := json.NewEncoder(temporary).Encode(tokens); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	directoryHandle, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer directoryHandle.Close()
	if err := directoryHandle.Sync(); err != nil {
		return err
	}
	return nil
}

func (m *snappTokenManager) accessToken() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.persistDirtyTokens(); err != nil {
		return "", err
	}
	if time.Now().Before(m.tokens.RefreshAt) {
		return m.tokens.AccessToken, nil
	}
	if err := m.refreshLocked(); err != nil {
		return "", err
	}
	return m.tokens.AccessToken, nil
}

func (m *snappTokenManager) refreshAfterUnauthorized(usedToken string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.persistDirtyTokens(); err != nil {
		return "", err
	}
	if m.tokens.AccessToken != usedToken {
		return m.tokens.AccessToken, nil
	}
	if err := m.refreshLocked(); err != nil {
		return "", err
	}
	return m.tokens.AccessToken, nil
}

func (m *snappTokenManager) persistDirtyTokens() error {
	if !m.dirty {
		return nil
	}
	if err := persistSnappTokens(m.config.tokenFile, m.tokens); err != nil {
		return fmt.Errorf("persist rotated Snapp tokens: %w", err)
	}
	m.dirty = false
	return nil
}

func (m *snappTokenManager) refreshLocked() error {
	requestBody := snappRefreshRequest{
		GrantType:    "refresh_token",
		ClientID:     m.config.clientID,
		ClientSecret: m.config.clientSecret,
		DeviceID:     m.config.deviceID,
		RefreshToken: m.tokens.RefreshToken,
	}
	body, err := json.Marshal(requestBody)
	if err != nil {
		return errors.New("encode Snapp refresh request")
	}
	ctx, cancel := context.WithTimeout(context.Background(), snappRefreshTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, snappRefreshURL, bytes.NewReader(body))
	if err != nil {
		return errors.New("create Snapp refresh request")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	if m.config.fingerprint != "" {
		req.Header.Set("X-Raw-Fingerprint", m.config.fingerprint)
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("send Snapp refresh request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Snapp refresh endpoint returned HTTP status %d", resp.StatusCode)
	}
	var refreshed snappRefreshResponse
	if err := decodeSnappTokenJSON(resp.Body, &refreshed); err != nil {
		return errors.New("decode Snapp refresh response")
	}
	if strings.TrimSpace(refreshed.AccessToken) == "" || strings.TrimSpace(refreshed.RefreshToken) == "" || refreshed.ExpiresIn <= 0 || refreshed.ExpiresIn > maxTokenLifetimeSecs {
		return errors.New("Snapp refresh response is missing valid token or expiry fields")
	}
	m.tokens = newSnappOAuthTokens(refreshed.AccessToken, refreshed.RefreshToken, time.Duration(refreshed.ExpiresIn)*time.Second, time.Now())
	m.dirty = true
	if err := m.persistDirtyTokens(); err != nil {
		return err
	}
	return nil
}
