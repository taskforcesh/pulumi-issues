import * as gcp from "@pulumi/gcp";
import { NodePool } from "@pulumi/gcp/container";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {
  ComponentResource,
  Config,
  CustomResourceOptions,
} from "@pulumi/pulumi";

const project = new Config("gcp").require("project");

export class Cluster extends ComponentResource {
  provider: k8s.Provider;

  mainPool: NodePool;

  constructor(name: string, opts: CustomResourceOptions = {}) {
    super("taskforce:cluster", name, {}, opts);
    const location = "europe-west4-a";

    const engineVersion = gcp.container
      .getEngineVersions({ location })
      .then((v) => v.latestMasterVersion);

    const cluster = new gcp.container.Cluster(
      name,
      {
        location,
        initialNodeCount: 1,
        removeDefaultNodePool: true,
        minMasterVersion: engineVersion,
      },
      { parent: this }
    );

    const oauthScopes = [
      "https://www.googleapis.com/auth/compute",
      "https://www.googleapis.com/auth/devstorage.read_only",
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/ndev.clouddns.readwrite",
      "https://www.googleapis.com/auth/service.management.readonly",
      "https://www.googleapis.com/auth/trace.append",
      "https://www.googleapis.com/auth/servicecontrol",
    ];

    /**
     * This node pool is used for the permanent infrastructure:
     * external-dns, contour, and  provisioner.
     */
    this.mainPool = new NodePool(
      "main",
      {
        location,
        cluster: cluster.name,
        initialNodeCount: 1,
        nodeConfig: {
          labels: {
            type: "main",
          },
          machineType: "e2-small",
          preemptible: true,
          oauthScopes,
        },
      },
      { parent: cluster, dependsOn: [cluster] }
    );

    const kubeconfig = pulumi
      .all([cluster.name, cluster.endpoint, cluster.masterAuth])
      .apply(([name, endpoint, masterAuth]) => {
        const context = `${gcp.config.project}_${location}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
      });

    // Create a Kubernetes provider instance that uses our cluster from above.
    this.provider = new k8s.Provider(
      name,
      {
        kubeconfig,
        suppressDeprecationWarnings: true,
      },
      { parent: this, dependsOn: [this.mainPool] }
    );

    this.registerOutputs({
      mainNodePool: this.mainPool,
      provider: this.provider,
      kubectl: kubeconfig,
    });
  }
}
