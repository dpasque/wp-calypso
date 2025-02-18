/**
 * External dependencies
 */
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { find } from 'lodash';
import { localize } from 'i18n-calypso';

/**
 * Internal dependencies
 */
import {
	activatePlugin,
	installPlugin as installAndActivatePlugin,
	fetchPlugins,
} from 'calypso/state/plugins/installed/actions';
import { Button, ProgressBar } from '@automattic/components';
import { CALYPSO_CONTACT } from 'calypso/lib/url/support';
import { fetchPluginData } from 'calypso/state/plugins/wporg/actions';
import { getAllPlugins as getAllWporgPlugins } from 'calypso/state/plugins/wporg/selectors';
import {
	getPlugins as getInstalledPlugins,
	getStatusForSite,
} from 'calypso/state/plugins/installed/selectors';
import SetupHeader from './setup/header';
import SetupNotices from './setup/notices';
import hasSitePendingAutomatedTransfer from 'calypso/state/selectors/has-site-pending-automated-transfer';
import { getAutomatedTransferStatus } from 'calypso/state/automated-transfer/selectors';
import { transferStates } from 'calypso/state/automated-transfer/constants';
import { getSelectedSiteWithFallback, getSiteWoocommerceUrl } from 'calypso/state/sites/selectors';
import { logToLogstash } from 'calypso/state/logstash/actions';
import { recordTrack } from '../lib/analytics';

// Time in seconds to complete various steps.
const TIME_TO_TRANSFER_ACTIVE = 5;
const TIME_TO_TRANSFER_UPLOADING = 5;
const TIME_TO_TRANSFER_BACKFILLING = 25;
const TIME_TO_TRANSFER_COMPLETE = 6;
const TIME_TO_PLUGIN_INSTALLATION = 60;
const TIME_TO_PLUGIN_ACTIVATION = 60;

const transferStatusesToTimes = {};

transferStatusesToTimes[ transferStates.PENDING ] = TIME_TO_TRANSFER_ACTIVE;

// ACTIVE and PENDING have the same time because it's a way to show some progress even
// if nothing happened yet (good for UX).
transferStatusesToTimes[ transferStates.ACTIVE ] =
	transferStatusesToTimes[ transferStates.PENDING ];

transferStatusesToTimes[ transferStates.UPLOADING ] =
	TIME_TO_TRANSFER_UPLOADING + transferStatusesToTimes[ transferStates.ACTIVE ];

transferStatusesToTimes[ transferStates.BACKFILLING ] =
	TIME_TO_TRANSFER_BACKFILLING + transferStatusesToTimes[ transferStates.UPLOADING ];

transferStatusesToTimes[ transferStates.COMPLETE ] =
	TIME_TO_TRANSFER_COMPLETE + transferStatusesToTimes[ transferStates.BACKFILLING ];

/**
 * Get the list of plugins required to use Store on WP.com
 *
 * @returns {Array} List of plugin slugs
 */
function getRequiredPluginsForCalypso() {
	return [ 'woocommerce', 'woocommerce-services' ];
}

/**
 * Get the list of plugins we want to install for site setup
 *
 * @returns {Array} List of plugin slugs
 */
function getPluginsForStoreSetup() {
	return [ 'woocommerce', 'woocommerce-gateway-stripe', 'woocommerce-services' ];
}

class RequiredPluginsInstallView extends Component {
	static propTypes = {
		fixMode: PropTypes.bool,
		site: PropTypes.shape( {
			ID: PropTypes.number.isRequired,
		} ),
		skipConfirmation: PropTypes.bool,
	};

	constructor( props ) {
		super( props );
		const { automatedTransferStatus } = this.props;
		this.state = {
			engineState: props.skipConfirmation ? 'INITIALIZING' : 'CONFIRMING',
			toActivate: [],
			toInstall: [],
			workingOn: '',
			progress:
				automatedTransferStatus &&
				transferStatusesToTimes[ automatedTransferStatus ] &&
				! ( transferStates.COMPLETE === automatedTransferStatus ) // Don't need to wait transfer, proceed with everything else.
					? transferStatusesToTimes[ automatedTransferStatus ]
					: 0,
			totalSeconds: this.getTotalSeconds(),
		};
		this.updateTimer = false;
		this.timeoutTimer = false;
	}

	componentDidMount() {
		const { hasPendingAT } = this.props;

		this.createUpdateTimer();

		if ( hasPendingAT ) {
			this.startSetup();
		}
	}

	componentWillUnmount() {
		this.destroyUpdateTimer();
		this.destroyTimeoutTimer();
	}

	UNSAFE_componentWillReceiveProps( nextProps ) {
		const { automatedTransferStatus: currentATStatus, siteId, hasPendingAT } = this.props;
		const { automatedTransferStatus: nextATStatus } = nextProps;

		if ( hasPendingAT && nextATStatus ) {
			this.setState( {
				progress: transferStatusesToTimes[ nextATStatus ],
			} );
		}

		const { BACKFILLING, COMPLETE } = transferStates;

		if ( BACKFILLING === currentATStatus && COMPLETE === nextATStatus ) {
			this.setState( {
				engineState: 'INITIALIZING',
				workingOn: '',
			} );

			this.props.fetchPlugins( [ siteId ] );
		}
	}

	createUpdateTimer = () => {
		if ( this.updateTimer ) {
			return;
		}

		// Proceed at rate of approximately 60 fps
		this.updateTimer = window.setInterval( () => {
			this.updateEngine();
		}, 17 );
	};

	destroyUpdateTimer = () => {
		if ( this.updateTimer ) {
			window.clearInterval( this.updateTimer );
			this.updateTimer = false;
		}
	};

	timeoutElapsed = () => {
		const { sitePlugins, pluginsStatus, automatedTransferStatus } = this.props;
		// These status means store setup is finished, not stalled.
		if ( [ 'IDLE', 'DONESUCCESS', 'DONEFAILURE' ].includes( this.state.engineState ) ) {
			return;
		}

		const plugins = Array.isArray( sitePlugins )
			? sitePlugins.flatMap( ( plugin ) => ( {
					id: plugin.id,
					active: plugin.active,
			  } ) )
			: sitePlugins;

		this.props.logToLogstash( {
			feature: 'calypso_client',
			message: 'woocommerce setup timeout',
			extra: {
				state: this.state,
				automatedTransferStatus,
				plugins,
				pluginsStatus,
			},
		} );

		recordTrack( 'calypso_woocommerce_setup_timeout', {
			engine_state: this.state.engineState,
			to_activate: this.state.toActivate.join( ',' ),
			to_install: this.state.toInstall.join( ',' ),
			working_on: this.state.workingOn,
			progress: this.state.progress,
			transfer_status: automatedTransferStatus,
		} );

		this.setState( {
			engineState: 'DONETIMEOUT',
		} );
	};

	destroyTimeoutTimer = () => {
		if ( this.timeoutTimer ) {
			window.clearTimeout( this.timeoutTimer );
			this.timeoutTimer = false;
		}
	};

	setTimeoutTimer = ( durationInSeconds ) => {
		if ( this.timeoutTimer ) {
			this.destroyTimeoutTimer();
		}

		this.timeoutTimer = window.setTimeout( this.timeoutElapsed, durationInSeconds * 1000 );
	};

	/**
	 * Sends a track for user contacting support.
	 *
	 * @param {string} reason Reason on why user would contact. Values can be 'failure' or 'timeout'.
	 */
	trackContactSupport = ( reason ) => {
		recordTrack( 'calypso_woocommerce_setup_contact_support', {
			reason,
		} );
	};

	doInitialization = () => {
		const { fixMode, site, sitePlugins, wporgPlugins } = this.props;
		const { workingOn } = this.state;

		if ( ! site ) {
			return;
		}

		let waitingForPluginListFromSite = false;
		if ( ! sitePlugins ) {
			waitingForPluginListFromSite = true;
		} else if ( ! Array.isArray( sitePlugins ) ) {
			waitingForPluginListFromSite = true;
		} else if ( 0 === sitePlugins.length ) {
			waitingForPluginListFromSite = true;
		}

		if ( waitingForPluginListFromSite ) {
			if ( workingOn === 'WAITING_FOR_PLUGIN_LIST_FROM_SITE' ) {
				return;
			}

			this.setState( {
				workingOn: 'WAITING_FOR_PLUGIN_LIST_FROM_SITE',
			} );
			this.setTimeoutTimer( transferStatusesToTimes[ transferStates.COMPLETE ] );
			return;
		}

		// Iterate over the required plugins, fetching plugin
		// data from wordpress.org for each into state
		const requiredPlugins = fixMode ? getRequiredPluginsForCalypso() : getPluginsForStoreSetup();
		let pluginDataLoaded = true;
		for ( const requiredPluginSlug of requiredPlugins ) {
			const pluginData = wporgPlugins?.[ requiredPluginSlug ] ?? {};
			// pluginData will be null until the action has had
			// a chance to try and fetch data for the plugin slug
			// given. Note that non-wp-org plugins
			// will be accepted too, but with
			// { fetched: false, wporg: false }
			// as their response
			if ( ! pluginData ) {
				this.props.fetchPluginData( requiredPluginSlug );
				pluginDataLoaded = false;
			}
		}
		if ( ! pluginDataLoaded ) {
			if ( workingOn === 'LOAD_PLUGIN_DATA' ) {
				return;
			}

			this.setState( {
				workingOn: 'LOAD_PLUGIN_DATA',
			} );
			this.setTimeoutTimer( transferStatusesToTimes[ transferStates.COMPLETE ] );
			return;
		}

		const toInstall = [];
		const toActivate = [];
		let pluginInstallationTotalSteps = 0;
		for ( const requiredPluginSlug of requiredPlugins ) {
			const pluginFound = find( sitePlugins, { slug: requiredPluginSlug } );
			if ( ! pluginFound ) {
				toInstall.push( requiredPluginSlug );
				toActivate.push( requiredPluginSlug );
				pluginInstallationTotalSteps++;
			} else if ( ! pluginFound.active ) {
				toActivate.push( requiredPluginSlug );
				pluginInstallationTotalSteps++;
			}
		}

		if ( toInstall.length ) {
			this.setState( {
				engineState: 'INSTALLING',
				toActivate,
				toInstall,
				workingOn: '',
				pluginInstallationTotalSteps,
			} );
			return;
		}

		if ( toActivate.length ) {
			this.setState( {
				engineState: 'ACTIVATING',
				toActivate,
				workingOn: '',
				pluginInstallationTotalSteps,
			} );
			return;
		}

		this.setState( {
			engineState: 'DONESUCCESS',
		} );
	};

	doInstallation = () => {
		const { pluginsStatus, site, sitePlugins } = this.props;

		// If we are working on nothing presently, get the next thing to install and install it
		if ( 0 === this.state.workingOn.length ) {
			const toInstall = this.state.toInstall;

			// Nothing left to install? Advance to activation step
			if ( 0 === toInstall.length ) {
				this.setState( {
					engineState: 'ACTIVATING',
				} );
				return;
			}

			const workingOn = toInstall.shift();
			// In lieu of waiting on details of plugins from wporg, let's assemble the object ourselves.
			const plugin = {
				id: workingOn,
				slug: workingOn,
			};

			this.setTimeoutTimer( TIME_TO_PLUGIN_INSTALLATION );
			this.props.installAndActivatePlugin( site.ID, plugin );

			this.setState( {
				toInstall,
				workingOn,
			} );
			return;
		}

		// Otherwise, if we are working on something presently, see if it has appeared in state yet
		const pluginFound = find( sitePlugins, { slug: this.state.workingOn } );
		if ( pluginFound ) {
			this.destroyTimeoutTimer();
			this.setState( {
				workingOn: '',
				progress: this.state.progress + this.getPluginInstallationTime(),
			} );
		}

		// Or, it's in the error state
		const pluginStatus = pluginsStatus[ this.state.workingOn ];
		if ( pluginStatus && 'error' === pluginStatus.status ) {
			this.setState( {
				engineState: 'DONEFAILURE',
			} );
			this.destroyTimeoutTimer();
		}
	};

	doActivation = () => {
		const { site, sitePlugins } = this.props;

		// If we are working on nothing presently, get the next thing to activate and activate it
		if ( 0 === this.state.workingOn.length ) {
			const toActivate = this.state.toActivate;

			// Nothing left to activate? Advance to done success
			if ( 0 === toActivate.length ) {
				this.setState( {
					engineState: 'DONESUCCESS',
				} );
				return;
			}

			const workingOn = toActivate.shift();

			// It is best to use sitePlugins to get the right id since the
			// plugin id isn't always slug/slug unless the main plugin PHP
			// file is the same name as the plugin folder
			const pluginToActivate = find( sitePlugins, { slug: workingOn } );
			// Already active? Skip it
			if ( pluginToActivate.active ) {
				this.setState( {
					toActivate,
					workingOn: '',
				} );
				return;
			}

			this.setTimeoutTimer( TIME_TO_PLUGIN_ACTIVATION );
			// Otherwise, activate!
			this.props.activatePlugin( site.ID, pluginToActivate );

			this.setState( {
				toActivate,
				workingOn,
			} );
			return;
		}

		// See if activation has appeared in state yet
		const pluginFound = find( sitePlugins, { slug: this.state.workingOn } );
		if ( pluginFound && pluginFound.active ) {
			this.setState( {
				workingOn: '',
				progress: this.state.progress + this.getPluginInstallationTime(),
			} );
		}
	};

	doneSuccess = () => {
		this.setState( {
			engineState: 'IDLE',
		} );
		this.destroyTimeoutTimer();

		// Delay to ensure user wont bump into permission error
		// that happens if navigated to wc-admin too soon.
		setTimeout( () => {
			window.location.replace( this.props.woocommerceUrl );
		}, 2000 );
		return false;
	};

	updateEngine = () => {
		switch ( this.state.engineState ) {
			case 'INITIALIZING':
				this.doInitialization();
				break;
			case 'INSTALLING':
				this.doInstallation();
				break;
			case 'ACTIVATING':
				this.doActivation();
				break;
			case 'DONESUCCESS':
				this.doneSuccess();
				break;
		}
	};

	getPluginInstallationTime = () => {
		const { pluginInstallationTotalSteps } = this.state;

		if ( pluginInstallationTotalSteps ) {
			return TIME_TO_PLUGIN_INSTALLATION / pluginInstallationTotalSteps;
		}

		// If there's some error, return 3 seconds for a single plugin installation time.
		return 3;
	};

	startSetup = () => {
		const { hasPendingAT } = this.props;

		recordTrack( 'calypso_woocommerce_dashboard_action_click', {
			action: 'initial-setup',
		} );

		if ( ! hasPendingAT ) {
			this.setState( {
				engineState: 'INITIALIZING',
			} );
			this.setTimeoutTimer( transferStatusesToTimes[ transferStates.COMPLETE ] );
		}
	};

	renderConfirmScreen = () => {
		const { translate } = this.props;
		return (
			<div className="dashboard__setup-wrapper setup__wrapper">
				<SetupNotices />
				<div className="card dashboard__setup-confirm">
					<SetupHeader
						imageSource={ '/calypso/images/extensions/woocommerce/woocommerce-setup.svg' }
						imageWidth={ 160 }
						title={ translate( 'Have something to sell?' ) }
						subtitle={ translate(
							'You can sell your products right on your site and ship them to customers in a snap!'
						) }
					>
						<Button onClick={ this.startSetup } primary>
							{ translate( 'Set up my store!' ) }
						</Button>
					</SetupHeader>
				</div>
			</div>
		);
	};

	getTotalSeconds = () => {
		const { hasPendingAT } = this.props;

		if ( hasPendingAT ) {
			return transferStatusesToTimes[ transferStates.COMPLETE ] + TIME_TO_PLUGIN_INSTALLATION;
		}

		return TIME_TO_PLUGIN_INSTALLATION;
	};

	renderContactSupportForFailure() {
		const { translate, wporgPlugins } = this.props;
		const { workingOn } = this.state;
		const plugin = wporgPlugins?.[ workingOn ] ?? {};

		const subtitle = [
			<p key="line-1">
				{ translate(
					"Your store is missing some required plugins. We can't fix this automatically " +
						'due to a problem with the {{b}}%(pluginName)s{{/b}} plugin.',
					{
						args: { pluginName: plugin.name || workingOn },
						components: { b: <strong /> },
					}
				) }
			</p>,
			<p key="line-2">
				{ translate( "Please contact support and we'll get your store back up and running!" ) }
			</p>,
		];

		return (
			<div className="dashboard__setup-wrapper setup__wrapper">
				<div className="card dashboard__plugins-install-view">
					<SetupHeader
						imageSource={ '/calypso/images/extensions/woocommerce/woocommerce-store-creation.svg' }
						imageWidth={ 160 }
						title={ translate( "We can't update your store" ) }
						subtitle={ subtitle }
					>
						<Button
							onClick={ () => {
								this.trackContactSupport( 'failure' );
							} }
							primary
							href={ CALYPSO_CONTACT }
							target="_blank"
							rel="noopener noreferrer"
						>
							{ this.props.translate( 'Get in touch' ) }
						</Button>
					</SetupHeader>
				</div>
			</div>
		);
	}

	renderContactSupportForTimeout() {
		const { translate } = this.props;

		const subtitle = [
			<p key="line-1">
				{ translate( "Please contact support and we'll get your store up and running!" ) }
			</p>,
		];

		return (
			<div className="dashboard__setup-wrapper setup__wrapper">
				<div className="card dashboard__plugins-install-view">
					<SetupHeader
						imageSource={ '/calypso/images/extensions/woocommerce/woocommerce-store-creation.svg' }
						imageWidth={ 160 }
						title={ translate( 'We were unable to set up your store.' ) }
						subtitle={ subtitle }
					>
						<Button
							onClick={ () => {
								this.trackContactSupport( 'timeout' );
							} }
							primary
							href={ CALYPSO_CONTACT }
							target="_blank"
							rel="noopener noreferrer"
						>
							{ translate( 'Get in touch' ) }
						</Button>
					</SetupHeader>
				</div>
			</div>
		);
	}

	render() {
		const { hasPendingAT, fixMode, translate } = this.props;
		const { engineState, progress, totalSeconds } = this.state;

		if ( ! hasPendingAT && 'CONFIRMING' === engineState ) {
			return this.renderConfirmScreen();
		}

		if ( 'DONEFAILURE' === engineState ) {
			return this.renderContactSupportForFailure();
		}

		if ( 'DONETIMEOUT' === engineState ) {
			return this.renderContactSupportForTimeout();
		}

		const title = fixMode ? translate( 'Updating your store' ) : translate( 'Building your store' );

		return (
			<div className="dashboard__setup-wrapper setup__wrapper">
				<SetupNotices />
				<div className="card dashboard__plugins-install-view">
					<SetupHeader
						imageSource={ '/calypso/images/extensions/woocommerce/woocommerce-store-creation.svg' }
						imageWidth={ 160 }
						title={ title }
						subtitle={ translate( "Give us a minute and we'll move right along." ) }
					>
						<ProgressBar value={ progress } total={ totalSeconds } isPulsing />
					</SetupHeader>
				</div>
			</div>
		);
	}
}

function mapStateToProps( state ) {
	const site = getSelectedSiteWithFallback( state );
	const siteId = site.ID;
	const sitePlugins = site ? getInstalledPlugins( state, [ siteId ] ) : [];
	const pluginsStatus = getStatusForSite( state, siteId );
	const woocommerceUrl = getSiteWoocommerceUrl( state, siteId );

	return {
		site,
		siteId,
		sitePlugins,
		pluginsStatus,
		wporgPlugins: getAllWporgPlugins( state ),
		automatedTransferStatus: getAutomatedTransferStatus( state, siteId ),
		hasPendingAT: hasSitePendingAutomatedTransfer( state, siteId ),
		woocommerceUrl,
	};
}

export default connect( mapStateToProps, {
	activatePlugin,
	fetchPluginData,
	installAndActivatePlugin,
	fetchPlugins,
	logToLogstash,
} )( localize( RequiredPluginsInstallView ) );
