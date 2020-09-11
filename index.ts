import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { ComponentResource, CustomResourceOptions } from "@pulumi/pulumi";
import { Cluster } from "./cluster";

export class MyComponent extends ComponentResource {
  constructor(name: string, opts: CustomResourceOptions = {}) {
    super("my:component", name, {}, opts);

    const bucket = new gcp.storage.Bucket(`${name}`, undefined, {
      parent: this,
    });

    this.registerOutputs({
      bucket,
    });
  }
}

const cluster = new Cluster("my-cluster");

const certManager = new k8s.yaml.ConfigFile(
  "certManager2",
  {
    file:
      "https://github.com/jetstack/cert-manager/releases/download/v1.0.1/cert-manager.yaml",
  },
  { provider: cluster.provider, dependsOn: [cluster] }
);

export const componentA = new MyComponent("astrid", {
  dependsOn: [certManager],
});
