"""Container entry point. The engine stays behind the bundled web proxy."""

from chorus.cli.launcher import launch_application


if __name__ == "__main__":
    launch_application(api_port=43187, web_port=43189, browser=False, production=True,
                       web_host="0.0.0.0", local_control=False)
