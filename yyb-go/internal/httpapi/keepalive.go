package httpapi

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"yyb_go/internal/protocol"
)

func envDuration(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	if raw == "0" {
		return 0
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value < 0 {
		log.Printf("invalid %s=%q, using %s", name, raw, fallback)
		return fallback
	}
	return value
}

func (a *App) startKeepalive() {
	interval := envDuration("YYB_KEEPALIVE_INTERVAL", time.Minute)
	if interval <= 0 {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.keepaliveCancel = cancel
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				a.runKeepalive(ctx)
			}
		}
	}()
}

func (a *App) runKeepalive(ctx context.Context) {
	accounts, err := a.db.ListAccounts(ctx)
	if err != nil {
		log.Printf("YYB keepalive list accounts: %v", err)
		return
	}
	directAhead := envDuration("YYB_KEEPALIVE_AHEAD", 45*time.Minute)
	proxyAhead := envDuration("YYB_KEEPALIVE_PROXY_AHEAD", 5*time.Minute)
	for _, acc := range accounts {
		if ctx.Err() != nil || acc.Credentials == nil {
			continue
		}
		creds := protocol.CredentialsFromMap(acc.Credentials)
		setting, settingErr := a.db.GetAccountProxySetting(ctx, acc.ID)
		if settingErr != nil {
			continue
		}
		ahead := directAhead
		if setting.Mode == "static" {
			ahead = proxyAhead
		}
		if !creds.Expired(ahead) {
			continue
		}
		status := a.refreshLiveness(ctx, acc)
		if status != "alive" {
			log.Printf("YYB keepalive account %d status=%s", acc.ID, status)
		}
	}
}
