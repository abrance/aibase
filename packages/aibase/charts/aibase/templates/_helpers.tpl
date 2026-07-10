{{/*
Expand the name of the chart.
*/}}
{{- define "aibase.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "aibase.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version label.
*/}}
{{- define "aibase.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "aibase.labels" -}}
helm.sh/chart: {{ include "aibase.chart" . }}
{{ include "aibase.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "aibase.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aibase.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "aibase.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "aibase.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Whether this release should create a managed secret.
*/}}
{{- define "aibase.hasManagedSecret" -}}
{{- if or (and .Values.opencode.serverAuth.enabled (not .Values.opencode.serverAuth.existingSecret) .Values.opencode.serverAuth.password) (and .Values.opencode.config.content (not .Values.opencode.config.existingSecret)) (and .Values.credentials.items (not .Values.credentials.existingSecret)) (and .Values.opencodeWeb.enabled .Values.opencodeWeb.serverAuth .Values.opencodeWeb.serverAuth.enabled (not .Values.opencodeWeb.serverAuth.existingSecret) .Values.opencodeWeb.serverAuth.password) -}}
true
{{- end -}}
{{- end }}
