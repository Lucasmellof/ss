{{- define "ss.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "ss.fullname" -}}
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

{{- define "ss.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "ss.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ss.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "ss.labels" -}}
helm.sh/chart: {{ include "ss.chart" . }}
{{ include "ss.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "ss.mediaMode" -}}
{{- $mode := .Values.media.mode }}
{{- if not (has $mode (list "hostNetwork" "hostPort" "loadBalancer")) }}
{{- fail (printf "media.mode must be one of hostNetwork, hostPort, loadBalancer (got %q)" $mode) }}
{{- end }}
{{- $mode }}
{{- end }}

{{- define "ss.singlePort" -}}
{{- if ne (include "ss.mediaMode" .) "hostNetwork" }}true{{- end }}
{{- end }}
