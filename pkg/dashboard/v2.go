// Copyright 2019 FairwindsOps Inc
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package dashboard

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/fairwindsops/goldilocks/pkg/summary"
	"k8s.io/klog/v2"
)

// NamespacesAPI returns a sorted JSON array of namespace names that have VPA data.
func NamespacesAPI(opts Options) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		filterLabels := make(map[string]string)
		if !opts.ShowAllVPAs {
			filterLabels = opts.VpaLabels
		}

		summarizer := summary.NewSummarizer(
			summary.ForNamespace(""),
			summary.ForVPAsWithLabels(filterLabels),
			summary.ExcludeContainers(opts.ExcludedContainers),
		)

		vpaData, err := summarizer.GetSummary()
		if err != nil {
			klog.Errorf("Error getting namespace list: %v", err)
			http.Error(w, "Error getting namespace list", http.StatusInternalServerError)
			return
		}

		namespaces := make([]string, 0, len(vpaData.Namespaces))
		for k := range vpaData.Namespaces {
			namespaces = append(namespaces, k)
		}
		sort.Strings(namespaces)

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(namespaces); err != nil {
			klog.Errorf("Error encoding namespace list: %v", err)
		}
	})
}

// V2Dashboard serves the new SPA frontend. It reads the embedded index.html and
// substitutes the {{BASE_PATH}} placeholder with the configured base path.
func V2Dashboard(opts Options) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		content, err := assetsFS.ReadFile("assets/v2/index.html")
		if err != nil {
			klog.Errorf("Error reading assets/v2/index.html: %v", err)
			http.Error(w, "Error reading dashboard", http.StatusInternalServerError)
			return
		}

		html := strings.ReplaceAll(string(content), "{{BASE_PATH}}", validateBasePath(opts.BasePath))

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if _, err := w.Write([]byte(html)); err != nil {
			klog.Errorf("Error writing v2 response: %v", err)
		}
	})
}
