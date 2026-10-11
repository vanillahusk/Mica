package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Message struct {
	ID     string   `json:"id"`
	Role   string   `json:"role"`
	Text   string   `json:"text"`
	Time   *float64 `json:"time"`
	Voice  bool     `json:"voice"`
	Format string   `json:"format,omitempty"`
}
type Conversation struct {
	Version   int       `json:"version"`
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	SourceURL string    `json:"sourceUrl"`
	UpdatedAt time.Time `json:"updatedAt"`
	Messages  []Message `json:"messages"`
	Complete  bool      `json:"complete,omitempty"`
}
type Envelope struct {
	Type            string       `json:"type"`
	ProtocolVersion int          `json:"protocolVersion"`
	Open            bool         `json:"open"`
	Conversation    Conversation `json:"conversation"`
}

func conversationPath(id string) string {
	return filepath.Join(dataDir(), "conversations", digest([]byte(id))+".json")
}
func withLock(key string, fn func() error) error {
	name, _ := windows.UTF16PtrFromString("Local\\MicaNative-" + digest([]byte(key)))
	h, e := windows.CreateMutex(nil, false, name)
	if e != nil {
		return e
	}
	defer windows.CloseHandle(h)
	result, e := windows.WaitForSingleObject(h, 5000)
	if e != nil {
		return e
	}
	if result != windows.WAIT_OBJECT_0 && result != windows.WAIT_ABANDONED {
		return errors.New("数据正在另一窗口保存，请重试")
	}
	defer windows.ReleaseMutex(h)
	return fn()
}
func readConversation(id string) (Conversation, error) {
	var c Conversation
	b, e := os.ReadFile(conversationPath(id))
	if e == nil {
		e = json.Unmarshal(b, &c)
	}
	return c, e
}
func listConversations() ([]Conversation, error) {
	out := []Conversation{}
	files, e := filepath.Glob(filepath.Join(dataDir(), "conversations", "*.json"))
	if e != nil {
		return nil, e
	}
	for _, f := range files {
		b, e := os.ReadFile(f)
		var c Conversation
		if e == nil && json.Unmarshal(b, &c) == nil {
			c.Messages = nil
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}
func upsert(c Conversation) (Conversation, error) {
	if len(c.ID) == 0 || len(c.ID) > 300 || len(c.Messages) > 100000 {
		return c, errors.New("同步内容无效")
	}
	for _, m := range c.Messages {
		if m.ID == "" || len(m.Text) > 8_000_000 {
			return c, errors.New("消息无效")
		}
	}
	err := withLock(conversationPath(c.ID), func() error {
		previous, e := readConversation(c.ID)
		if e != nil && !os.IsNotExist(e) {
			return e
		}
		index := map[string]int{}
		if c.Complete {
			if len(c.Messages) == 0 {
				return errors.New("完整会话为空，未覆盖本地数据")
			}
			if len(previous.Messages) > 0 {
				backup, err := json.MarshalIndent(previous, "", "  ")
				if err != nil {
					return err
				}
				if err = atomicWrite(conversationPath(c.ID)+".before-sync.bak", backup); err != nil {
					return err
				}
			}
			previous.Messages = nil
		}
		for i, m := range previous.Messages {
			index[m.ID] = i
		}
		for _, m := range c.Messages {
			if i, ok := index[m.ID]; ok {
				previous.Messages[i] = m
			} else {
				index[m.ID] = len(previous.Messages)
				previous.Messages = append(previous.Messages, m)
			}
		}
		c.Messages = previous.Messages
		if !c.Complete {
			sort.SliceStable(c.Messages, func(i, j int) bool {
				l, r := c.Messages[i].Time, c.Messages[j].Time
				if l == nil {
					return false
				}
				if r == nil {
					return true
				}
				return *l < *r
			})
		}
		c.Version = 1
		c.UpdatedAt = time.Now().UTC()
		b, e := json.MarshalIndent(c, "", "  ")
		if e != nil {
			return e
		}
		return atomicWrite(conversationPath(c.ID), b)
	})
	return c, err
}
func serveNative(input io.Reader, output io.Writer) {
	for {
		var length uint32
		if binary.Read(input, binary.LittleEndian, &length) != nil {
			return
		}
		if length == 0 || length > 64*1024*1024 {
			return
		}
		b := make([]byte, length)
		if _, e := io.ReadFull(input, b); e != nil {
			return
		}
		var request Envelope
		err := json.Unmarshal(b, &request)
		var c Conversation
		if err == nil {
			if request.Type != "syncConversation" || request.ProtocolVersion != 1 {
				err = errors.New("不支持的同步协议")
			} else {
				c, err = upsert(request.Conversation)
			}
		}
		response := map[string]interface{}{"ok": err == nil}
		if err != nil {
			response["error"] = err.Error()
		} else {
			response["conversationId"] = c.ID
			response["messageCount"] = len(c.Messages)
			if request.Open {
				ex, e := os.Executable()
				if e == nil {
					_ = exec.Command(ex, "--open", c.ID).Start()
				}
			}
		}
		payload, _ := json.Marshal(response)
		if binary.Write(output, binary.LittleEndian, uint32(len(payload))) != nil {
			return
		}
		if _, e := output.Write(payload); e != nil {
			return
		}
	}
}
func runNativeHost() { serveNative(os.Stdin, os.Stdout) }
func installNativeHost(extension string) error {
	extension = strings.TrimSpace(extension)
	if !regexp.MustCompile(`^[a-p]{32}$`).MatchString(extension) {
		return errors.New("扩展 ID 应为 32 位 a-p 字母")
	}
	ex, e := os.Executable()
	if e != nil {
		return e
	}
	path := filepath.Join(dataDir(), "native-host", "com.mica.desktop.json")
	b, _ := json.MarshalIndent(map[string]interface{}{"name": "com.mica.desktop", "description": "Mica native sync", "path": ex, "type": "stdio", "allowed_origins": []string{"chrome-extension://" + extension + "/"}}, "", "  ")
	if e = atomicWrite(path, b); e != nil {
		return e
	}
	for _, browser := range []string{`Software\Google\Chrome`, `Software\Microsoft\Edge`} {
		k, _, e := registry.CreateKey(registry.CURRENT_USER, browser+`\NativeMessagingHosts\com.mica.desktop`, registry.SET_VALUE)
		if e != nil {
			return e
		}
		e = k.SetStringValue("", path)
		k.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
